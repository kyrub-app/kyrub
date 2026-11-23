import {FieldValue} from 'firebase-admin/firestore';
import {adminDb} from '../firebaseAdmin.js';
import {isTagId} from '../../shared/kyrubTagContract.js';

const markers=()=>adminDb.collection('kyrub_tag_minimal_identities');
const users=()=>adminDb.collection('users');
const tags=()=>adminDb.collection('kyrub_official_tags');
const validUid=(uid:string)=>/^[A-Za-z0-9_-]{1,128}$/.test(uid);
export type TagIdentityMode='full'|'tag_only'|'unclassified';

/** A minimal tag identity is NOT a Kyrub user profile, store, or plan. */
export async function getTagIdentityMode(uid:string):Promise<{mode:TagIdentityMode}>{
 if(!validUid(uid))throw Error('TAG_FORBIDDEN');
 const [account,marker]=await Promise.all([users().doc(uid).get(),markers().doc(uid).get()]);
 if(account.exists||marker.get('mode')==='full')return {mode:'full'};
 if(marker.get('mode')==='tag_only'&&marker.get('uid')===uid)return {mode:'tag_only'};
 return {mode:'unclassified'};
}

/**
 * Called after verified email-link sign-in, before claiming a promotional tag.
 * Keep existing Kyrub accounts untouched; never create users/{uid} or a store.
 */
export async function prepareTagMinimalIdentity(uid:string,id:string){
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
 if(!validUid(uid))throw Error('TAG_FORBIDDEN');
 return adminDb.runTransaction(async tx=>{
  const ref=markers().doc(uid);
  const marker=await tx.get(ref);
  if(!marker.exists||marker.get('uid')!==uid||!['tag_only','full'].includes(marker.get('mode')))throw Error('TAG_NOT_MINIMAL');
  if(marker.get('mode')==='full')return {mode:'full' as const,replay:true};
  tx.update(ref,{mode:'full',promotedAt:FieldValue.serverTimestamp()});
  return {mode:'full' as const,replay:false};
 });
}
