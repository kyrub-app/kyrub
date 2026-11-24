import { randomBytes } from 'node:crypto';
import { adminDb } from '../firebaseAdmin.js';
import { buildPublicDestinationUrl } from '../../shared/publicDestinationRoutes.js';
import { resolveSocialAddress } from './publicSocialAddressService.js';
import { loadPublicStorefrontBySlug } from '../payments/marketplaceDiscoveryService.js';
import { cardLink, isCardId, isBoundTarget, parseCardTargets, CARD_LIMIT, type CardTarget, type CardLink } from './publicCardPolicy.js';
type Bound = CardTarget & {bindingId:string};
const cards=()=>adminDb.collection('public_visit_cards');
const owners=()=>adminDb.collection('public_visit_card_owners');
export async function resolveTarget(actor:string,target:CardTarget,expected?:string):Promise<{binding:Bound;link:CardLink}|null>{
  if(target.kind==='store'){
    const result=await loadPublicStorefrontBySlug(target.identifier);
    if(!result||result.store.slug!==target.identifier||!result.store.name||!/^[A-Za-z0-9_-]{1,128}$/.test(result.store.id))return null;
    if(expected&&expected!==result.store.id)return null;
    return {binding:{...target,bindingId:result.store.id},link:cardLink(target,result.store.name)};
  }
  const mapping=(await adminDb.collection('public_social_addresses').doc(target.kind+':'+target.identifier).get()).data();
  if(!mapping||mapping.kind!==target.kind||mapping.identifier!==target.identifier||typeof mapping.targetId!=='string'||!/^[A-Za-z0-9_-]{1,128}$/.test(mapping.targetId))return null;
  if(expected&&expected!==mapping.targetId)return null;
  if(target.kind==='profile'&&mapping.targetId!==actor)return null;
  const result=await resolveSocialAddress(target.kind,target.identifier);
  if(!result)return null;
  return {binding:{...target,bindingId:mapping.targetId},link:cardLink(target,result.name)};
}
/** Only owned, publicly reachable spaces are offered by the profile picker.
 * Existing card links remain supported by the ordinary multifunction editor.
 */
export async function listOwnedPresentationSpaces(actor:string):Promise<CardLink[]>{
 if(!/^[A-Za-z0-9_-]{1,128}$/.test(actor))throw Error('INVALID_CARD');
 const [communities,tenants,stores]=await Promise.all([
  adminDb.collection('communities').where('ownerId','==',actor).limit(100).get(),
  adminDb.collection('tenants').where('ownerId','==',actor).limit(100).get(),
  adminDb.collection('stores').where('ownerId','==',actor).limit(100).get()
 ]);
 const candidates:Bound[]=[];
 for(const doc of communities.docs){
  if(!['public','moderated'].includes(doc.get('visibility')))continue;
  const address=(await adminDb.doc('public_social_address_targets/community:'+doc.id).get()).data();
  if(address?.kind==='community'&&address.targetId===doc.id&&typeof address.identifier==='string'&&buildPublicDestinationUrl('community',address.identifier))
   candidates.push({kind:'community',identifier:address.identifier,bindingId:doc.id});
 }
 for(const doc of [...tenants.docs,...stores.docs]){
  const slug=doc.get('slug');
  if(doc.get('publicationStatus')==='published'&&typeof slug==='string'&&buildPublicDestinationUrl('store',slug))
   candidates.push({kind:'store',identifier:slug,bindingId:doc.id});
 }
 const links=new Map<string,CardLink>();
 for(let i=0;i<candidates.length;i+=8){
  const results=await Promise.all(candidates.slice(i,i+8).map(async candidate=>{
   const resolved=await resolveTarget(actor,candidate,candidate.bindingId);
   return resolved?.link??null;
  }));
  for(const link of results)if(link)links.set(link.url,link);
 }
 return [...links.values()].sort((a,b)=>a.name.localeCompare(b.name,'pt-BR'));
}
export async function loadOwnedCard(actor:string){
  const owner=(await owners().doc(actor).get()).data();
  if(!isCardId(owner?.id))return null;
  const card=(await cards().doc(owner.id).get()).data();
  if(!card||card.ownerId!==actor)return null;
  const targets=Array.isArray(card.targets)?card.targets.filter(isBoundTarget).slice(0,CARD_LIMIT):[];
  return {id:owner.id,enabled:card.enabled===true,urls:targets.map(t=>cardLink(t,'Destino').url)};
}
export async function saveOwnedCard(actor:string,urls:unknown){
  const requested=parseCardTargets(urls);
  const resolved=await Promise.all(requested.map(t=>resolveTarget(actor,t)));
  if(resolved.some(t=>!t))throw Error('CARD_TARGET_UNAVAILABLE');
  const targets=resolved.flatMap(t=>t?[t.binding]:[]);
  // One permanent card per owner; all writes serialized by owner transaction.
  const newId=randomBytes(16).toString('hex');
  return adminDb.runTransaction(async tx=>{
    const ownerRef=owners().doc(actor);
    const owner=(await tx.get(ownerRef)).data();
    if(owner&&!isCardId(owner.id))throw Error('CARD_UNAVAILABLE');
    const id=owner?.id as string|undefined??newId;
    const cardRef=cards().doc(id);
    const card=await tx.get(cardRef);
    if(owner){
      if(!card.exists||card.data()?.ownerId!==actor)throw Error('CARD_UNAVAILABLE');
      tx.update(cardRef,{targets,enabled:true});
    }else{
      if(card.exists)throw Error('CARD_UNAVAILABLE');
      tx.create(ownerRef,{id});
      tx.create(cardRef,{ownerId:actor,targets,enabled:true});
    }
    return {id,enabled:true,urls:requested.map(t=>cardLink(t,'Destino').url)};
  });
}
export async function disableOwnedCard(actor:string){
  return adminDb.runTransaction(async tx=>{
    const owner=(await tx.get(owners().doc(actor))).data();
    if(!isCardId(owner?.id))return null;
    const ref=cards().doc(owner.id);
    const card=(await tx.get(ref)).data();
    if(!card||card.ownerId!==actor)throw Error('CARD_UNAVAILABLE');
    tx.update(ref,{enabled:false});
    return {id:owner.id,enabled:false};
  });
}
export async function resolvePublicCard(id:string):Promise<{id:string;links:CardLink[]}|null>{
  if(!isCardId(id))return null;
  const ref=cards().doc(id);
  const snapshot=await ref.get();
  const card=snapshot.data();
  if(!card||card.enabled!==true||typeof card.ownerId!=='string'||!Array.isArray(card.targets)||card.targets.length>CARD_LIMIT)return null;
  const targets=card.targets.filter(isBoundTarget);
  const links=await Promise.all(targets.map(t=>resolveTarget(card.ownerId,t,t.bindingId)));
  // Avoid returning a stale snapshot after a concurrent update/revocation.
  const current=await ref.get();
  if(!snapshot.updateTime||!current.updateTime||!current.updateTime.isEqual(snapshot.updateTime)||current.data()?.enabled!==true)return null;
  return {id,links:links.flatMap(t=>t?[t.link]:[])};
}

/** Authenticated surface, explicit public projection, no legacy posts or private fields. */
export async function resolveContactPresentation(targetId:string){
 if(!/^[A-Za-z0-9_-]{1,128}$/.test(targetId))throw Error('INVALID_CARD');
 const accountRef=adminDb.doc('users/'+targetId),profileRef=accountRef.collection('public_profile').doc('main');
 const [account,profile,owner]=await Promise.all([accountRef.get(),profileRef.get(),owners().doc(targetId).get()]);
 if(!account.exists||account.get('isProfileVisible')!==true)return null;
 const clean=(v:unknown,max:number)=>typeof v==='string'?v.trim().slice(0,max):'';
 const name=clean(profile.get('name'),160)||clean(account.get('name'),160)||'Kairubido';
 const photo=clean(profile.get('photoUrl')||account.get('photoUrl'),2048);
 const cardId=owner.get('id');
 let links:CardLink[]=[];
 if(isCardId(cardId)){
  const record=await cards().doc(cardId).get();
  if(record.get('ownerId')===targetId&&record.get('enabled')===true){
   const publicCard=await resolvePublicCard(cardId);
   links=(publicCard?.links??[]).filter(link=>link.kind==='community'||link.kind==='store');
  }
 }
 const [latestAccount,latestProfile]=await Promise.all([accountRef.get(),profileRef.get()]);
 if(latestAccount.get('isProfileVisible')!==true||!account.updateTime||!latestAccount.updateTime?.isEqual(account.updateTime)||
    profile.exists!==latestProfile.exists||(profile.exists&&!latestProfile.updateTime?.isEqual(profile.updateTime!)))return null;
 return {name,occupation:clean(profile.get('occupation'),90),bio:clean(profile.get('bio'),280),
  photoUrl:/^https:\/\//i.test(photo)?photo:'',coverUrl:/^https:\/\//i.test(clean(profile.get('coverUrl'),2048))?clean(profile.get('coverUrl'),2048):'',backgroundUrl:/^https:\/\//i.test(clean(profile.get('backgroundUrl'),2048))?clean(profile.get('backgroundUrl'),2048):'',links};
}
