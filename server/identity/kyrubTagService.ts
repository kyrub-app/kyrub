import {randomBytes,createHash,timingSafeEqual} from 'node:crypto';
import {adminDb} from '../firebaseAdmin.js';
import {assertTagPilotWriteIsolated} from './kyrubTagPilotIsolation.js';
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
 return {id,model:data.model,enabled:data.enabled===true,...(typeof data.nickname==='string'&&data.nickname?{nickname:data.nickname}:{}),urls:[...targets.map(t=>cardLink(t,'Destino').url),...externalLinks(data.externalUrls).map(t=>t.url)].slice(0,CARD_LIMIT),
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

export async function claimPromotionalKyrubTag(actor:string,id:string,verifiedEmail:unknown,initialPresentation?:unknown){
 assertTagPilotWriteIsolated();
 validActor(actor);
 const email=normalizeTagRecipientEmail(verifiedEmail);
 if(!promotionalEnabled())throw Error('TAG_PROMO_DISABLED');
 if(!isTagId(id)||!email)throw Error('TAG_FORBIDDEN');
 const presentation=initialPresentation===undefined?undefined:normalizePromotionalPresentation(initialPresentation);
 if(presentation?.coverPath||presentation?.avatarPath||presentation?.backgroundPath)throw Error('TAG_PRESENTATION_INVALID');
 const newRecoveryCode=randomBytes(24).toString('hex');
 return adminDb.runTransaction(async tx=>{
  const ref=tags().doc(id),identity=adminDb.doc('kyrub_tag_minimal_identities/'+actor);
  const [snap,account,marker]=await Promise.all([
   tx.get(ref),tx.get(adminDb.doc('users/'+actor)),tx.get(identity)
  ]);
  const data=snap.data();
  if(data?.ownerId===actor&&data.distribution==='promotional')return {tag:owned(id,data),recoveryCode:null};
  if(!isOpenPromotionalTag(data))throw Error('TAG_FORBIDDEN');
  // A verified email identity can own a tag without becoming a Kyrub user.
  if(!account.exists&&!marker.exists){
   tx.create(identity,{uid:actor,mode:'tag_only',source:'kyrub_tag_promo',
    createdFromTag:id,createdAt:new Date().toISOString()});
  }else if(marker.exists&&marker.get('uid')!==actor)throw Error('TAG_FORBIDDEN');
  const next={...data,ownerId:actor,firstOwnerId:actor,ownerEmailHash:hashTagRecipient(id,email),
   recoveryHash:promotionalRecoveryHash(id,newRecoveryCode),claimedAt:new Date().toISOString(),
    ...(presentation?{presentation,enabled:true,updatedAt:new Date().toISOString()}:{})};
  tx.update(ref,{ownerId:actor,firstOwnerId:actor,ownerEmailHash:next.ownerEmailHash,
   recoveryHash:next.recoveryHash,claimedAt:next.claimedAt,
    ...(presentation?{presentation,enabled:true,updatedAt:new Date().toISOString()}:{})});
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
  if(data?.distribution!=='promotional'||typeof data.ownerId!=='string'||data.ownerId===actor||
    !/^[a-f0-9]{64}$/.test(oldHash)||!timingSafeEqual(Buffer.from(oldHash,'hex'),Buffer.from(requestedHash,'hex')))throw Error('TAG_FORBIDDEN');
  const update={ownerId:actor,ownerEmailHash:hashTagRecipient(id,email),recoveryHash:promotionalRecoveryHash(id,nextRecoveryCode),
    recoveryCount:typeof data.recoveryCount==='number'?data.recoveryCount+1:1,lastRecoveredAt:new Date().toISOString(),
    enabled:false,blocked:true,nickname:'',targets:[]};
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
  if(data?.distribution!=='promotional'||data.ownerId!==actor)throw Error('TAG_FORBIDDEN');
  tx.update(ref,{recoveryHash:promotionalRecoveryHash(id,recoveryCode),recoveryRotatedAt:new Date().toISOString()});
  return {tag:owned(id,data),recoveryCode};
 });
}

export async function configurePromotionalKyrubTag(actor:string,id:string,input:unknown){
 assertTagPilotWriteIsolated();
 validActor(actor);
 if(!isTagId(id))throw Error('TAG_INVALID');
 const presentation=normalizePromotionalPresentation(input);
 await validatePromotionalMediaReferences(actor,id,presentation);
 return adminDb.runTransaction(async tx=>{
  const ref=tags().doc(id),snap=await tx.get(ref),data=snap.data();
  if(data?.distribution!=='promotional'||data.ownerId!==actor||data.blocked===true)throw Error('TAG_FORBIDDEN');
  tx.update(ref,{presentation,enabled:true,updatedAt:new Date().toISOString()});
  return owned(id,{...data,presentation,enabled:true});
 });
}

export async function setPromotionalBlock(actor:string,id:string,blocked:boolean){
 assertTagPilotWriteIsolated();
 validActor(actor);
 if(!isTagId(id))throw Error('TAG_INVALID');
 return adminDb.runTransaction(async tx=>{
  const ref=tags().doc(id),snap=await tx.get(ref),data=snap.data();
  if(data?.distribution!=='promotional'||data.ownerId!==actor)throw Error('TAG_FORBIDDEN');
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
export async function renameOwnedKyrubTag(actor:string,id:string,value:unknown){
 assertTagPilotWriteIsolated();validActor(actor);
 if(!isTagId(id)||typeof value!=='string'||value.length>48||/[\u0000-\u001f\u007f]/.test(value))throw Error('TAG_INVALID');
 const nickname=value.trim();
 return adminDb.runTransaction(async tx=>{
  const ref=tags().doc(id),data=(await tx.get(ref)).data();
  if(!data||data.ownerId!==actor)throw Error('TAG_FORBIDDEN');
  tx.update(ref,{nickname});
  return owned(id,{...data,nickname});
 });
}

/** Copy an explicitly reviewed saved profile to selected promotional units.
 * No cross-device storage reference; private media has already been staged per unit.
 */
export async function syncProfilePresentationToTags(actor:string,input:unknown){
 assertTagPilotWriteIsolated();validActor(actor);
 if(!input||typeof input!=='object'||Array.isArray(input))throw Error('TAG_INVALID');
 const data=input as Record<string,unknown>;
 const {tagIds,expected,fields,media}=data;
 if(Object.keys(data).some(k=>!['tagIds','expected','fields','media'].includes(k))||
  !Array.isArray(tagIds)||!tagIds.length||tagIds.length>100||!tagIds.every(isTagId)||new Set(tagIds).size!==tagIds.length||
  !Array.isArray(fields)||!fields.length||new Set(fields).size!==fields.length||!fields.every(k=>['text','avatar','cover','background'].includes(k))||
  !expected||typeof expected!=='object'||Array.isArray(expected)||!media||typeof media!=='object'||Array.isArray(media))throw Error('TAG_INVALID');
 const reviewed=expected as Record<string,unknown>,mediaMap=media as Record<string,unknown>;
 const keys=['name','occupation','bio','photoUrl','coverUrl','backgroundUrl'];
 if(Object.keys(reviewed).length!==keys.length||!keys.every(k=>typeof reviewed[k]==='string'&&String(reviewed[k]).length<=2048)||
  Object.keys(mediaMap).some(id=>!tagIds.includes(id)))throw Error('TAG_INVALID');
 const slots=(['avatar','cover','background'] as const).filter(slot=>fields.includes(slot));
 if(slots.some(slot=>!reviewed[slot==='avatar'?'photoUrl':slot==='cover'?'coverUrl':'backgroundUrl']))throw Error('TAG_INVALID');
 const prepared=new Map<string,{avatarPath?:string;coverPath?:string;backgroundPath?:string}>();
 for(const id of tagIds){
  const raw=mediaMap[id];
  if(slots.length&&(!raw||typeof raw!=='object'||Array.isArray(raw)))throw Error('TAG_INVALID');
  const item=(raw??{}) as Record<string,unknown>;
  if(Object.keys(item).length!==slots.length||!slots.every(slot=>typeof item[slot+'Path']==='string'&&item[slot+'Path']))throw Error('TAG_INVALID');
  const images={...(slots.includes('avatar')?{avatarPath:item.avatarPath as string}:{}),...(slots.includes('cover')?{coverPath:item.coverPath as string}:{}),...(slots.includes('background')?{backgroundPath:item.backgroundPath as string}:{})};
  if(slots.length){
   const unit=(await tags().doc(id).get()).data();
   if(unit?.ownerId!==actor||unit.distribution!=='promotional'||unit.enabled!==true||unit.blocked===true)throw Error('TAG_FORBIDDEN');
   await validatePromotionalMediaReferences(actor,id,{...EMPTY_PROMOTIONAL_PRESENTATION,...images});
  }
  prepared.set(id,images);
 }
 return adminDb.runTransaction(async tx=>{
  const accountRef=adminDb.doc('users/'+actor),profileRef=accountRef.collection('public_profile').doc('main');
  const refs=tagIds.map(id=>tags().doc(id));
  const [account,profile,...units]=await Promise.all([tx.get(accountRef),tx.get(profileRef),...refs.map(ref=>tx.get(ref))]);
  if(!account.exists||!profile.exists)throw Error('TAG_FORBIDDEN');
  if(keys.some(k=>(typeof profile.get(k)==='string'?profile.get(k):'')!==reviewed[k]))throw Error('TAG_CHANGED');
  const text=fields.includes('text')?normalizePromotionalPresentation({name:reviewed.name,occupation:reviewed.occupation,about:reviewed.bio}):null;
  const updates=units.map((snap,i)=>{
   const unit=snap.data();
   if(unit?.ownerId!==actor||unit.distribution!=='promotional'||unit.enabled!==true||unit.blocked===true)throw Error('TAG_FORBIDDEN');
   const existing=normalizePromotionalPresentation(unit.presentation??EMPTY_PROMOTIONAL_PRESENTATION);
   const presentation=normalizePromotionalPresentation({...existing,...(text??{}),...prepared.get(refs[i].id)});
   return {ref:refs[i],unit,presentation};
  });
  for(const item of updates)tx.update(item.ref,{presentation:item.presentation,updatedAt:new Date().toISOString()});
  return {tags:updates.map(item=>owned(item.ref.id,{...item.unit,presentation:item.presentation}))};
 });
}

/** Add only explicitly selected destinations from the owner's published card. */
export async function addOwnedCardSpacesToTags(actor:string,ids:unknown,urls:unknown){
 assertTagPilotWriteIsolated();validActor(actor);
 if(!Array.isArray(ids)||ids.length<1||ids.length>100||!ids.every(isTagId)||new Set(ids).size!==ids.length)throw Error('TAG_INVALID');
 const requested=parseCardTargets(urls);
 if(requested.some(t=>t.kind==='profile'))throw Error('INVALID_CARD');
 const ownerRef=adminDb.doc('public_visit_card_owners/'+actor);
 const owner=(await ownerRef.get()).data();
 if(!isTagId(owner?.id))throw Error('CARD_TARGET_UNAVAILABLE');
 const cardRef=adminDb.doc('public_visit_cards/'+owner.id),original=await cardRef.get(),source=original.data();
 if(source?.ownerId!==actor||source.enabled!==true||!Array.isArray(source.targets))throw Error('CARD_TARGET_UNAVAILABLE');
 const available=source.targets.filter(isBoundTarget);
 const selected=requested.map(t=>available.find(b=>b.kind===t.kind&&b.identifier===t.identifier));
 if(selected.some(t=>!t))throw Error('CARD_TARGET_UNAVAILABLE');
 const resolved=await Promise.all(selected.map(t=>t?resolveTarget(actor,t,t.bindingId):null));
 if(resolved.some(t=>!t))throw Error('CARD_TARGET_UNAVAILABLE');
 const additions=resolved.flatMap(t=>t?[t.binding]:[]);
 return adminDb.runTransaction(async tx=>{
  const refs=ids.map(id=>tags().doc(id));
  const [account,currentOwner,currentCard,...units]=await Promise.all([
   tx.get(adminDb.doc('users/'+actor)),tx.get(ownerRef),tx.get(cardRef),...refs.map(ref=>tx.get(ref))
  ]);
  if(!account.exists||currentOwner.get('id')!==owner.id||!original.updateTime||!currentCard.updateTime?.isEqual(original.updateTime))throw Error('CARD_TARGET_UNAVAILABLE');
  const updates=units.map((snap,i)=>{
   const data=snap.data();
   if(!data||data.ownerId!==actor||data.blocked===true||data.enabled!==true||!isTagModel(data.model))throw Error('TAG_FORBIDDEN');
   const merged=Array.isArray(data.targets)?data.targets.filter(isBoundTarget):[];
   for(const target of additions){
    const previous=merged.find(t=>t.kind===target.kind&&t.identifier===target.identifier);
    if(previous&&previous.bindingId!==target.bindingId)throw Error('TAG_CHANGED');
    if(!previous)merged.push(target);
   }
   if(merged.length+externalLinks(data.externalUrls).length>CARD_LIMIT)throw Error('INVALID_CARD');
   return {ref:refs[i],data,targets:merged};
  });
  for(const item of updates)tx.update(item.ref,{targets:item.targets,updatedAt:new Date().toISOString()});
  return {tags:updates.map(item=>owned(item.ref.id,{...item.data,targets:item.targets}))};
 });
}
/** Remove destinations only; never republish a blocked or unpublished unit. */
export async function removePromotionalTagSpace(actor:string,id:string,url:unknown){
 assertTagPilotWriteIsolated();validActor(actor);
 if(!isTagId(id)||typeof url!=='string')throw Error('TAG_INVALID');
 const target=parsePublicDestinationUrl(url);
 if(!target||(target.kind!=='store'&&target.kind!=='community'))throw Error('TAG_INVALID');
 return adminDb.runTransaction(async tx=>{
  const ref=tags().doc(id),data=(await tx.get(ref)).data();
  if(data?.ownerId!==actor||data.distribution!=='promotional')throw Error('TAG_FORBIDDEN');
  const existing=Array.isArray(data.targets)?data.targets.filter(isBoundTarget):[];
  const targets=existing.filter(t=>t.kind!==target.kind||t.identifier!==target.identifier);
  if(targets.length!==existing.length)tx.update(ref,{targets,updatedAt:new Date().toISOString()});
  return owned(id,{...data,targets});
 });
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
  if(!data||data.ownerId!==actor)throw Error('TAG_FORBIDDEN');
  tx.update(ref,{enabled:false});
  return owned(id,{...data,enabled:false});
 });
}
export async function resolveKyrubTag(id:string):Promise<{id:string;model:KyrubTagModel;status:'unclaimed'|'active';activation?:'account'|'code'|'email'|'setup';links:(CardLink|TagExternalLink)[];presentation?:PublicPromotionalTagPresentation}|null>{
 if(!isTagId(id))return null;
 const ref=tags().doc(id),snapshot=await ref.get(),data=snapshot.data();
 if(!data||!isTagModel(data.model))return null;
 if(data.ownerId===null){
  if(isOpenPromotionalTag(data))return {id,model:data.model,status:'unclaimed',activation:promotionalEnabled()?'email':'setup',links:[]};
  return {id,model:data.model,status:'unclaimed',activation:typeof data.reservedEmailHash==='string'?'account':'code',links:[]};
 }
 if(data.enabled!==true||data.blocked===true||typeof data.ownerId!=='string'||!Array.isArray(data.targets)||data.targets.length+externalLinks(data.externalUrls).length>CARD_LIMIT)return null;
 const targets=data.targets.filter(isBoundTarget);
 const links=(await Promise.all(targets.map(t=>resolveTarget(data.ownerId,t,t.bindingId)))).flatMap(t=>t?[t.link]:[]);
 const current=await ref.get();
 if(!snapshot.updateTime||!current.updateTime||!current.updateTime.isEqual(snapshot.updateTime)||current.data()?.enabled!==true)return null;
 return {id,model:data.model,status:'active',links:[...links,...externalLinks(data.externalUrls)],...(data.distribution==='promotional'?{presentation:publicPromotionalPresentation(normalizePromotionalPresentation(data.presentation??EMPTY_PROMOTIONAL_PRESENTATION))}:{})};
}
