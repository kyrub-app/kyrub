import { randomBytes } from 'node:crypto';
import { normalizeVisitCardPresentation, readVisitCardPresentation, hasVisitCardPresentation, type VisitCardPresentation } from '../../shared/visitCardPresentation.js';
import { adminDb } from '../firebaseAdmin.js';
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
export async function loadOwnedCard(actor:string){
  const owner=(await owners().doc(actor).get()).data();
  if(!isCardId(owner?.id))return null;
  const card=(await cards().doc(owner.id).get()).data();
  if(!card||card.ownerId!==actor)return null;
  const targets=Array.isArray(card.targets)?card.targets.filter(isBoundTarget).slice(0,CARD_LIMIT):[];
  const presentation=readVisitCardPresentation(card.presentation);
  return {id:owner.id,enabled:card.enabled===true,urls:targets.map(t=>cardLink(t,'Destino').url),...(presentation?{presentation}:{})};
}
export async function saveOwnedCard(actor:string,urls:unknown,rawPresentation?:unknown){
  const presentation=rawPresentation===undefined?undefined:normalizeVisitCardPresentation(rawPresentation);
  const requested=Array.isArray(urls)&&urls.length===0&&hasVisitCardPresentation(presentation)?[]:parseCardTargets(urls);
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
      tx.update(cardRef,{targets,enabled:true,...(presentation?{presentation}:{})});
    }else{
      if(card.exists)throw Error('CARD_UNAVAILABLE');
      tx.create(ownerRef,{id});
      tx.create(cardRef,{ownerId:actor,targets,enabled:true,...(presentation?{presentation}:{})});
    }
    return {id,enabled:true,urls:requested.map(t=>cardLink(t,'Destino').url),...(presentation?{presentation}:{})};
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
export async function resolvePublicCard(id:string):Promise<{id:string;links:CardLink[];presentation?:VisitCardPresentation}|null>{
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
  const presentation=readVisitCardPresentation(card.presentation);
  return {id,links:links.flatMap(t=>t?[t.link]:[]),...(presentation?{presentation}:{})};
}
