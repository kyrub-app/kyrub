import {FieldValue} from 'firebase-admin/firestore';
import {adminAuth,adminDb} from '../firebaseAdmin.js';
import {assertTagPilotWriteIsolated} from './kyrubTagPilotIsolation.js';
import {requireCurrentIngressLegalReceiptInTransaction} from '../governance/ingressLegalReceiptService.js';
import {isTagId} from '../../shared/kyrubTagContract.js';

const markers=()=>adminDb.collection('kyrub_tag_minimal_identities');
const users=()=>adminDb.collection('users');
const tags=()=>adminDb.collection('kyrub_official_tags');
const validUid=(uid:string)=>/^[A-Za-z0-9_-]{1,128}$/.test(uid);
export type TagIdentityMode='full'|'tag_only'|'unclassified';

/** A minimal tag identity is NOT a Kyrub user profile, store, or plan. */
export async function getTagIdentityMode(uid:string):Promise<{mode:TagIdentityMode}>{
 if(!validUid(uid))throw Error('TAG_FORBIDDEN');
 return adminDb.runTransaction<{mode:TagIdentityMode}>(async tx=>{
  const [account,marker]=await Promise.all([tx.get(users().doc(uid)),tx.get(markers().doc(uid))]);
  // Existing accounts without a promotional marker retain their legacy entry.
  // A marker must never override its own UID or stale eligibility.
  if(!marker.exists)return {mode:account.exists?'full':'unclassified'};
  if(marker.get('uid')!==uid)throw Error('TAG_FORBIDDEN');
  if(marker.get('mode')==='tag_only')return {mode:'tag_only'};
  if(marker.get('mode')!=='full')throw Error('TAG_FORBIDDEN');
  const age=await tx.get(adminDb.doc('age_eligibility_private/'+uid));
  if(process.env.KYRUB_TAG_FULL_ACCOUNT_RELEASE_ENABLED!=='true'||age.get('uid')!==uid||age.get('status')!=='verified_adult')return {mode:'tag_only'};
  try{
   const receiptId=await requireCurrentIngressLegalReceiptInTransaction(tx,uid);
   return {mode:marker.get('ingressReceiptId')===receiptId?'full':'tag_only'};
  }catch(error){
   if(error instanceof Error&&['LEGAL_CURRENT_RECEIPT_REQUIRED','LEGAL_DOCUMENTS_UNAVAILABLE','LEGAL_RECEIPT_INVALID'].includes(error.message))return {mode:'tag_only'};
   throw error;
  }
 });
}

/**
 * Called after verified email-link sign-in, before claiming a promotional tag.
 * Keep existing Kyrub accounts untouched; never create users/{uid} or a store.
 */
export async function prepareTagMinimalIdentity(uid:string,id:string){
 assertTagPilotWriteIsolated();
 if(!validUid(uid)||!isTagId(id))throw Error('TAG_FORBIDDEN');
 if(process.env.KYRUB_TAG_PROMO_FIRST_CLAIM_ENABLED!=='true')throw Error('TAG_PROMO_DISABLED');
 return adminDb.runTransaction(async tx=>{
  const marker=markers().doc(uid);
  const [tag,account,current]=await Promise.all([
   tx.get(tags().doc(id)),tx.get(users().doc(uid)),tx.get(marker)
  ]);
  const data=tag.data();
  if(data?.distribution!=='promotional'||!(data.ownerId===null||data.ownerId===uid))
   throw Error('TAG_FORBIDDEN');
  if(account.exists||current.get('mode')==='full')return {mode:'full' as const};
  if(current.exists){
   if(current.get('uid')!==uid||current.get('mode')!=='tag_only')throw Error('TAG_FORBIDDEN');
   return {mode:'tag_only' as const};
  }
  tx.create(marker,{uid,mode:'tag_only',source:'kyrub_tag_promo',
   createdFromTag:id,createdAt:FieldValue.serverTimestamp()});
  return {mode:'tag_only' as const};
 });
}

/** Requires a deliberate user action; the ordinary workspace bootstrap follows only afterward. */
export async function promoteTagIdentityToKyrub(uid:string){
 assertTagPilotWriteIsolated();
 if(!validUid(uid))throw Error('TAG_FORBIDDEN');
 const identity=await adminAuth.getUser(uid);
 if(identity.disabled||!identity.emailVerified||!identity.email)throw Error('TAG_FORBIDDEN');
 return adminDb.runTransaction(async tx=>{
  const ref=markers().doc(uid);
  const [marker,age]=await Promise.all([tx.get(ref),tx.get(adminDb.doc('age_eligibility_private/'+uid))]);
  if(process.env.KYRUB_TAG_FULL_ACCOUNT_RELEASE_ENABLED!=='true'||age.get('uid')!==uid||age.get('status')!=='verified_adult')throw Error('TAG_PROMOTION_AGE_REQUIRED');
  if(!marker.exists||marker.get('uid')!==uid||!['tag_only','full'].includes(marker.get('mode')))throw Error('TAG_NOT_MINIMAL');
  const ingressReceiptId=await requireCurrentIngressLegalReceiptInTransaction(tx,uid);
  if(marker.get('mode')==='full'){
   // Preserve original promotion instant. Track subsequent acceptance separately.
   if(marker.get('ingressReceiptId')!==ingressReceiptId)tx.update(ref,{ingressReceiptId,ingressRevalidatedAt:FieldValue.serverTimestamp()});
   return {mode:'full' as const,replay:true};
  }
  tx.update(ref,{mode:'full',ingressReceiptId,promotedAt:FieldValue.serverTimestamp()});
  return {mode:'full' as const,replay:false};
 });
}
