import {randomBytes,createHash,timingSafeEqual} from 'node:crypto';
import {adminDb} from '../firebaseAdmin.js';
import {assertTagPilotWriteIsolated,tagPasskeyUnitOrigin,cidPixEmulatorEnabled} from './kyrubTagPilotIsolation.js';
import {EMPTY_PROMOTIONAL_PRESENTATION,isOpenPromotionalTag,normalizePromotionalPresentation,publicPromotionalPresentation,type PromotionalTagPresentation,type PublicPromotionalTagPresentation} from '../../shared/kyrubTagPromotional.js';
import {validatePromotionalMediaReferences} from './kyrubTagMediaService.js';
import {isTagId,isTagModel,tagUrl,normalizeTagRecipientEmail,parseTagExternalUrl,type TagExternalLink,type TagDestinationCatalog,type TagDestinationOption,type KyrubTagModel,type OwnedKyrubTag} from '../../shared/kyrubTagContract.js';
import {parseCardTargets,isBoundTarget,cardLink,CARD_LIMIT,type CardLink} from './publicCardPolicy.js';
import {resolveTarget} from './publicVisitCardService.js';
import {getOwnedSocialAddress} from './publicSocialAddressService.js';
import {parsePublicDestinationUrl,buildPublicDestinationUrl} from '../../shared/publicDestinationRoutes.js';
const externalLinks=(value:unknown):TagExternalLink[]=>Array.isArray(value)?value.flatMap(v=>{const p=parseTagExternalUrl(v);return p?[p]:[];}):[];
const tags=()=>adminDb.collection('kyrub_official_tags');
const promotionalEnabled=()=>process.env.KYRUB_TAG_PROMO_FIRST_CLAIM_ENABLED==='true';
const promotionalRecoveryHash=(id:string,code:string)=>createHash('sha256').update('kyrub-tag-promo-recovery-v1:'+id+':'+code).digest('hex');
const validActor=(actor:string)=>{if(!/^[A-Za-z0-9_-]{1,128}$/.test(actor))throw Error('TAG_FORBIDDEN');};
export const hashKyrubTagActivation=(id:string,code:string)=>createHash('sha256').update('kyrub-tag-v1:'+id+':'+code).digest('hex');
export const hashTagRecipient=(id:string,email:string)=>createHash('sha256').update('kyrub-tag-recipient-v1:'+id+':'+email).digest('hex');
function owned(id:string,data:Record<string,unknown>):OwnedKyrubTag{
 if(!isTagId(id)||!isTagModel(data.model))throw Error('TAG_UNAVAILABLE');
 const targets=Array.isArray(data.targets)?data.targets.filter(isBoundTarget).slice(0,CARD_LIMIT):[];
 return {id,model:data.model,enabled:data.enabled===true,urls:[...targets.map(t=>cardLink(t,'Destino').url),...externalLinks(data.externalUrls).map(t=>t.url)].slice(0,CARD_LIMIT),
 ...(data.distribution==='promotional'?{distribution:'promotional' as const,presentation:normalizePromotionalPresentation(data.presentation??EMPTY_PROMOTIONAL_PRESENTATION),blocked:data.blocked===true}:{})};
}
// Trusted manufacturing service only. No client or HTTP provisioning route.
// Return the secret once for a separate sealed activation code, never NDEF.
export async function provisionKyrubTag(model:KyrubTagModel){
 if(!isTagModel(model))throw Error('TAG_INVALID');
 const id=randomBytes(16).toString('hex'),code=randomBytes(16).toString('hex');
 await tags().doc(id).create({model,ownerId:null,enabled:false,targets:[],activationHash:hashKyrubTagActivation(id,code),createdAt:new Date().toISOString()});
 return {id,code,url:tagUrl(id)};
}
export async function claimKyrubTag(actor:string,id:string,code:unknown){
 validActor(actor);
 if(!isTagId(id)||!isTagId(code))throw Error('TAG_INVALID');
 return adminDb.runTransaction(async tx=>{
  const ref=tags().doc(id);
  const [snapshot,account]=await Promise.all([tx.get(ref),tx.get(adminDb.doc('users/'+actor))]);
  const data=snapshot.data();
  if(!account.exists||!data||!isTagModel(data.model))throw Error('TAG_FORBIDDEN');
  // A consumed code can never change the original owner. Even disabled tags
  // remain bound. Use GET to recover after a successful claim.
  if(data.ownerId!==null||data.reservedEmailHash!=null||typeof data.activationHash!=='string'||!/^[a-f0-9]{64}$/.test(data.activationHash))throw Error('TAG_FORBIDDEN');
  if(!timingSafeEqual(Buffer.from(data.activationHash,'hex'),Buffer.from(hashKyrubTagActivation(id,code),'hex')))throw Error('TAG_FORBIDDEN');
  const next={model:data.model,ownerId:actor,enabled:false,targets:[],activationHash:null,claimedAt:new Date().toISOString()};
  tx.update(ref,next);
  return owned(id,next);
 });
}
/**
 * Trusted manufacturing path only; not exposed as an anonymous HTTP endpoint.
 * Promotional stock intentionally has NO preselected recipient or activation code.
 * Only the first successfully verified Firebase e-mail identity may own it.
 * Existing reserved pilot 001 and protected inventory never satisfy this policy.
 */
export async function provisionPromotionalKyrubTag(){
 assertTagPilotWriteIsolated();
 if(!promotionalEnabled())throw Error('TAG_PROMO_DISABLED');
 const id=randomBytes(16).toString('hex');
 await tags().doc(id).create({
  model:'adesivo',distribution:'promotional',ownerId:null,enabled:false,blocked:false,
  activationHash:null,reservedEmailHash:null,targets:[],externalUrls:[],
  presentation:EMPTY_PROMOTIONAL_PRESENTATION,createdAt:new Date().toISOString()
 });
 return {id,url:tagUrl(id)};
}

export async function claimPromotionalKyrubTag(actor:string,id:string,verifiedEmail:unknown){
 assertTagPilotWriteIsolated();
 validActor(actor);
 const email=normalizeTagRecipientEmail(verifiedEmail);
 if(!promotionalEnabled())throw Error('TAG_PROMO_DISABLED');
 if(!isTagId(id)||!email)throw Error('TAG_FORBIDDEN');
 const newRecoveryCode=randomBytes(24).toString('hex');
 return adminDb.runTransaction(async tx=>{
  const ref=tags().doc(id),identity=adminDb.doc('kyrub_tag_minimal_identities/'+actor);
  const [snap,account,marker]=await Promise.all([
   tx.get(ref),tx.get(adminDb.doc('users/'+actor)),tx.get(identity)
  ]);
  const data=snap.data();
  if(data?.ownerAuthMode==='passkey')throw Error('TAG_FORBIDDEN');
  if(data?.ownerId===actor&&data.distribution==='promotional')return {tag:owned(id,data),recoveryCode:null};
  if(!isOpenPromotionalTag(data))throw Error('TAG_FORBIDDEN');
  // A verified email identity can own a tag without becoming a Kyrub user.
  if(!account.exists&&!marker.exists){
   tx.create(identity,{uid:actor,mode:'tag_only',source:'kyrub_tag_promo',
    createdFromTag:id,createdAt:new Date().toISOString()});
  }else if(marker.exists&&marker.get('uid')!==actor)throw Error('TAG_FORBIDDEN');
  const next={...data,ownerId:actor,firstOwnerId:actor,ownerEmailHash:hashTagRecipient(id,email),
   recoveryHash:promotionalRecoveryHash(id,newRecoveryCode),claimedAt:new Date().toISOString()};
  tx.update(ref,{ownerId:actor,firstOwnerId:actor,ownerEmailHash:next.ownerEmailHash,
   recoveryHash:next.recoveryHash,claimedAt:next.claimedAt});
  return {tag:owned(id,next),recoveryCode:newRecoveryCode};
 });
}

/**
 * A high-entropy recovery code can change the management identity only after
 * the NEW e-mail identity has itself been verified through Firebase Auth.
 * Keep immutable firstOwnerId for audit, rotate the code in the same transaction.
 */
export async function recoverPromotionalKyrubTag(actor:string,id:string,verifiedEmail:unknown,code:unknown){
 assertTagPilotWriteIsolated();
 validActor(actor);
 const email=normalizeTagRecipientEmail(verifiedEmail);
 if(!promotionalEnabled())throw Error('TAG_PROMO_DISABLED');
 if(!isTagId(id)||!email||typeof code!=='string'||!/^[a-f0-9]{48}$/.test(code))throw Error('TAG_FORBIDDEN');
 const nextRecoveryCode=randomBytes(24).toString('hex');
 return adminDb.runTransaction(async tx=>{
  const ref=tags().doc(id),identity=adminDb.doc('kyrub_tag_minimal_identities/'+actor);
  const [snap,account,marker]=await Promise.all([
   tx.get(ref),tx.get(adminDb.doc('users/'+actor)),tx.get(identity)
  ]);
  const data=snap.data();
  const oldHash=typeof data?.recoveryHash==='string'?data.recoveryHash:'';
  const requestedHash=promotionalRecoveryHash(id,code);
  if(data?.distribution!=='promotional'||data.ownerAuthMode==='passkey'||typeof data.ownerId!=='string'||data.ownerId===actor||
    !/^[a-f0-9]{64}$/.test(oldHash)||!timingSafeEqual(Buffer.from(oldHash,'hex'),Buffer.from(requestedHash,'hex')))throw Error('TAG_FORBIDDEN');
  const update={ownerId:actor,ownerEmailHash:hashTagRecipient(id,email),recoveryHash:promotionalRecoveryHash(id,nextRecoveryCode),
    recoveryCount:typeof data.recoveryCount==='number'?data.recoveryCount+1:1,lastRecoveredAt:new Date().toISOString(),
    enabled:false,blocked:true};
  if(!account.exists&&!marker.exists){
   tx.create(identity,{uid:actor,mode:'tag_only',source:'kyrub_tag_promo',
    createdFromTag:id,createdAt:new Date().toISOString()});
  }else if(marker.exists&&marker.get('uid')!==actor)throw Error('TAG_FORBIDDEN');
  tx.update(ref,update);
  return {tag:owned(id,{...data,...update}),recoveryCode:nextRecoveryCode};
 });
}

/**
 * Reissue a recovery credential while the owner still controls the verified
 * authentication identity. Old recovery codes immediately stop working.
 */
export async function rotatePromotionalRecoveryCode(actor:string,id:string){
 assertTagPilotWriteIsolated();
 validActor(actor);
 if(!isTagId(id))throw Error('TAG_INVALID');
 const recoveryCode=randomBytes(24).toString('hex');
 return adminDb.runTransaction(async tx=>{
  const ref=tags().doc(id),snap=await tx.get(ref),data=snap.data();
  if(data?.distribution!=='promotional'||data.ownerAuthMode==='passkey'||data.ownerId!==actor)throw Error('TAG_FORBIDDEN');
  tx.update(ref,{recoveryHash:promotionalRecoveryHash(id,recoveryCode),recoveryRotatedAt:new Date().toISOString()});
  return {tag:owned(id,data),recoveryCode};
 });
}

export async function configurePromotionalKyrubTag(actor:string,id:string,input:unknown){
 assertTagPilotWriteIsolated();
 validActor(actor);
 if(!isTagId(id))throw Error('TAG_INVALID');
 const presentation=normalizePromotionalPresentation(input);
 if(presentation.pix!==undefined)throw Error('TAG_PRESENTATION_INVALID');
 const ref=tags().doc(id),initial=await ref.get(),before=initial.data();
 if(before?.distribution!=='promotional'||before.ownerAuthMode==='passkey'||before.ownerId!==actor||before.blocked===true)throw Error('TAG_FORBIDDEN');
 await validatePromotionalMediaReferences(actor,id,presentation);
 const existing=Array.isArray(before.targets)?before.targets.filter(isBoundTarget):[];
 const requested=presentation.destinations;
 const resolved=requested===undefined?null:await Promise.all((requested.length?parseCardTargets(requested):[]).map(target=>resolveTarget(actor,target,existing.find(t=>t.kind===target.kind&&t.identifier===target.identifier)?.bindingId)));
 if(resolved?.some(target=>!target))throw Error('CARD_TARGET_UNAVAILABLE');
 const targets=resolved===null?existing:resolved.flatMap(target=>target?[target.binding]:[]);
 // Destination bindings are authoritative, not arbitrary URLs in public presentation.
 return adminDb.runTransaction(async tx=>{
  const snap=await tx.get(ref),data=snap.data();
  if(data?.distribution!=='promotional'||data.ownerAuthMode==='passkey'||data.ownerId!==actor||data.blocked===true)throw Error('TAG_FORBIDDEN');
  if(!initial.updateTime||!snap.updateTime?.isEqual(initial.updateTime))throw Error('TAG_CHANGED');
  tx.update(ref,{presentation,targets,enabled:true,updatedAt:new Date().toISOString()});
  return owned(id,{...data,presentation,targets,enabled:true});
 });
}

export async function setPromotionalBlock(actor:string,id:string,blocked:boolean){
 assertTagPilotWriteIsolated();
 validActor(actor);
 if(!isTagId(id))throw Error('TAG_INVALID');
 return adminDb.runTransaction(async tx=>{
  const ref=tags().doc(id),snap=await tx.get(ref),data=snap.data();
  if(data?.distribution!=='promotional'||data.ownerAuthMode==='passkey'||data.ownerId!==actor)throw Error('TAG_FORBIDDEN');
  tx.update(ref,{blocked,enabled:false,blockedAt:blocked?new Date().toISOString():null});
  return owned(id,{...data,blocked,enabled:false});
 });
}

// Email comes exclusively from the verified, current Firebase Auth identity.
export async function claimReservedKyrubTag(actor:string,id:string,verifiedEmail:unknown){
 validActor(actor);
 const email=normalizeTagRecipientEmail(verifiedEmail);
 if(!isTagId(id)||!email)throw Error('TAG_FORBIDDEN');
 return adminDb.runTransaction(async tx=>{
  const ref=tags().doc(id);
  const [snapshot,account]=await Promise.all([tx.get(ref),tx.get(adminDb.doc('users/'+actor))]);
  const data=snapshot.data();
  if(!account.exists||!data||!isTagModel(data.model))throw Error('TAG_FORBIDDEN');
  if(data.ownerId===actor)return owned(id,data);
  if(data.ownerId!==null||data.pilotBatch!=='experimental-001'||data.pilotSlot!=='001'||data.model!=='adesivo'||data.activationHash!==null||data.reservedEmailHash!==hashTagRecipient(id,email)||(data.reservedForUid!=null&&data.reservedForUid!==actor))throw Error('TAG_FORBIDDEN');
  const next={model:data.model,ownerId:actor,enabled:false,targets:[],activationHash:null,reservedEmailHash:null,reservedForUid:null,claimedAt:new Date().toISOString()};
  tx.update(ref,next);return owned(id,next);
 });
}
export async function loadOwnedKyrubTag(actor:string,id:string){
 validActor(actor);
 if(!isTagId(id))throw Error('TAG_INVALID');
 const d=(await tags().doc(id).get()).data();
 if(!d||d.ownerId!==actor)throw Error('TAG_FORBIDDEN');
 return owned(id,d);
}
export async function listOwnedKyrubTags(actor:string){
 validActor(actor);
 const records=await tags().where('ownerId','==',actor).limit(101).get();
 const visible=records.docs.slice(0,100).map(d=>owned(d.id,d.data()));
 if(visible.length)return {tags:visible,hasMore:records.size>100};
 // Pilot compatibility: the admin lot stores an authoritative pointer to unit 001.
 // A zero-row owner query must not hide a pilot that a direct, server-side read
 // proves belongs to this same authenticated actor. Never disclose other owners.
 const slot=await adminDb.doc('kyrub_tag_pilot_lots/experimental-001/units/001').get();
 const id=slot.get('tagId');
 if(isTagId(id)){
  const record=await tags().doc(id).get(),data=record.data();
  if(data?.ownerId===actor&&data.pilotBatch==='experimental-001'&&data.pilotSlot==='001'&&data.model==='adesivo'){
   console.warn('[kyrub-tag] owned-list query missed verified pilot; direct owner read recovered it');
   return {tags:[owned(id,data)],hasMore:false,pilotRecovered:true};
  }
 }
 return {tags:visible,hasMore:false};
}
export async function loadTagDestinationCatalog(actor:string,id:string):Promise<TagDestinationCatalog>{
 const current=await loadOwnedKyrubTag(actor,id);
 if(current.distribution==='promotional')throw Error('TAG_FORBIDDEN');
 const profile=await getOwnedSocialAddress(actor,'profile');
 const [stores,tenants,publicTenants,communities]=await Promise.all([
  adminDb.collection('stores').where('ownerId','==',actor).limit(20).get(),
  adminDb.collection('tenants').where('ownerId','==',actor).limit(20).get(),
  adminDb.collection('tenants').where('publicationStatus','==','published').limit(30).get(),
  adminDb.collection('public_social_addresses').where('kind','==','community').limit(30).get()
 ]);
 const candidates=new Set<string>();
 const add=(kind:'profile'|'store'|'community',identifier:unknown)=>{
  if(typeof identifier==='string'){const url=buildPublicDestinationUrl(kind,identifier);if(url)candidates.add(url);}
 };
 if(profile.eligible&&profile.identifier)add('profile',profile.identifier);
 for(const d of [...stores.docs,...tenants.docs,...publicTenants.docs])if(d.get('publicationStatus')==='published')add('store',d.get('slug'));
 for(const d of communities.docs)add('community',d.get('identifier'));
 for(const url of current.urls)candidates.add(url);
 const stored=(await tags().doc(id).get()).data();
 if(stored?.ownerId!==actor)throw Error('TAG_FORBIDDEN');
 const existing=new Map((Array.isArray(stored.targets)?stored.targets.filter(isBoundTarget):[]).map(t=>[cardLink(t,'Destino').url,t.bindingId]));
 // Resolve live public sources in bounded groups; never expose internal IDs
 // or names from private source documents.
 const options:TagDestinationOption[]=[];
 const items=[...candidates];
 for(let i=0;i<items.length;i+=8){
  const group=await Promise.all(items.slice(i,i+8).map(async url=>{
   const external=parseTagExternalUrl(url);if(external)return external;
   const p=parsePublicDestinationUrl(url);if(!p||p.kind==='card')return null;
   const result=await resolveTarget(actor,{kind:p.kind,identifier:p.identifier},existing.get(url));
   return result?.link??null;
  }));
  for(const option of group)if(option)options.push({kind:option.kind,name:option.name,url:option.url});
 }
 return {profile,options,unavailable:current.urls.filter(url=>!options.some(o=>o.url===url))};
}
export async function configureKyrubTag(actor:string,id:string,urls:unknown){
 validActor(actor);
 if(!isTagId(id))throw Error('TAG_INVALID');
 if(!Array.isArray(urls)||urls.length<1||urls.length>CARD_LIMIT||new Set(urls).size!==urls.length)throw Error('INVALID_CARD');
 const external=externalLinks(urls);
 const internal=urls.filter(url=>!parseTagExternalUrl(url));
 const requested=internal.length?parseCardTargets(internal):[];
 const ref=tags().doc(id);
 const initialSnapshot=await ref.get();
 const initial=initialSnapshot.data();
 if(initial?.ownerId!==actor||initial.distribution==='promotional')throw Error('TAG_FORBIDDEN');
 const existing=new Map((Array.isArray(initial.targets)?initial.targets.filter(isBoundTarget):[]).map(t=>[cardLink(t,'Destino').url,t.bindingId]));
 const resolved=await Promise.all(requested.map(t=>resolveTarget(actor,t,existing.get(cardLink(t,'Destino').url))));
 if(resolved.some(t=>!t))throw Error('CARD_TARGET_UNAVAILABLE');
 const targets=resolved.flatMap(t=>t?[t.binding]:[]);
 return adminDb.runTransaction(async tx=>{
  const snapshot=await tx.get(ref),data=snapshot.data();
  if(!data||data.ownerId!==actor||data.distribution==='promotional')throw Error('TAG_FORBIDDEN');
  if(!initialSnapshot.updateTime||!snapshot.updateTime?.isEqual(initialSnapshot.updateTime))throw Error('TAG_CHANGED');
  const externalUrls=external.map(l=>l.url);
  tx.update(ref,{targets,externalUrls,enabled:true});
  return owned(id,{...data,targets,externalUrls,enabled:true});
 });
}
export async function disableKyrubTag(actor:string,id:string){
 validActor(actor);
 if(!isTagId(id))throw Error('TAG_INVALID');
 return adminDb.runTransaction(async tx=>{
  const ref=tags().doc(id);
  const data=(await tx.get(ref)).data();
  if(!data||data.ownerId!==actor||data.ownerAuthMode==='passkey')throw Error('TAG_FORBIDDEN');
  tx.update(ref,{enabled:false});
  return owned(id,{...data,enabled:false});
 });
}
export async function resolveKyrubTag(id:string):Promise<{id:string;model:KyrubTagModel;status:'unclaimed'|'active'|'blocked';activation?:'account'|'code'|'email'|'setup';passkeyManaged?:boolean;passkeyOrigin?:string;cidPixAvailable?:boolean;links:(CardLink|TagExternalLink)[];presentation?:PublicPromotionalTagPresentation}|null>{
 if(!isTagId(id))return null;
 const ref=tags().doc(id),snapshot=await ref.get(),data=snapshot.data();
 if(!data||!isTagModel(data.model))return null;
 if(data.manufacturingState!==undefined&&data.manufacturingState!=='released')return {id,model:data.model,status:'unclaimed',activation:'setup',links:[]};
 if(data.ownerId===null){
  if(isOpenPromotionalTag(data)){const origin=tagPasskeyUnitOrigin(id,data);return {id,model:data.model,status:'unclaimed',activation:promotionalEnabled()?'email':'setup',links:[],...(origin?{passkeyOrigin:origin,...(cidPixEmulatorEnabled()?{cidPixAvailable:true}:{})}:{})};}
  return {id,model:data.model,status:'unclaimed',activation:typeof data.reservedEmailHash==='string'?'account':'code',links:[]};
 }
 if(data.ownerAuthMode==='passkey'&&data.distribution==='promotional'&&data.blocked===true){const origin=tagPasskeyUnitOrigin(id,data);return {id,model:data.model,status:'blocked',links:[],passkeyManaged:true,...(origin?{passkeyOrigin:origin}:{})};}
 if(data.enabled!==true||data.blocked===true||typeof data.ownerId!=='string'||!Array.isArray(data.targets)||data.targets.length+externalLinks(data.externalUrls).length>CARD_LIMIT)return null;
 const targets=data.targets.filter(isBoundTarget);
 const links=(await Promise.all(targets.map(t=>resolveTarget(data.ownerAuthMode==='passkey'&&typeof data.linkedAccountId==='string'?data.linkedAccountId:data.ownerId,t,t.bindingId)))).flatMap(t=>t?[t.link]:[]);
 const current=await ref.get();
 if(!snapshot.updateTime||!current.updateTime||!current.updateTime.isEqual(snapshot.updateTime)||current.data()?.enabled!==true)return null;
 const origin=data.ownerAuthMode==='passkey'?tagPasskeyUnitOrigin(id,data):null;
 return {id,model:data.model,status:'active',links:[...links,...externalLinks(data.externalUrls)],...(data.ownerAuthMode==='passkey'?{passkeyManaged:true,...(origin?{passkeyOrigin:origin,...(cidPixEmulatorEnabled()?{cidPixAvailable:true}:{})}:{})}:{}),...(data.distribution==='promotional'?{presentation:publicPromotionalPresentation(normalizePromotionalPresentation(data.presentation??EMPTY_PROMOTIONAL_PRESENTATION),data.ownerAuthMode==='passkey'&&cidPixEmulatorEnabled())}:{})};
}
