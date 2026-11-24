import {FieldValue} from 'firebase-admin/firestore';
import {adminDb} from '../firebaseAdmin.js';
import {createTribeVerifier,verifyTribeCode,failedTribeAttempt,tribeAttemptLocked,issueTribeSession,validTribeSession,validTribeCode,type TribeAttemptState,type TribeVerifier} from './reservedTribeSecurity.js';
/** Server-only foundation. No public route or UI is exposed until every contact surface is gated.
 * Callers must derive actor exclusively from verified authentication, never request body.
 */
function vault(actor:string){
 if(!/^[A-Za-z0-9_-]{1,128}$/.test(actor))throw Error('TRIBE_ACCESS_DENIED');
 return adminDb.doc('reserved_tribe_vaults/'+actor);
}
export async function initializeReservedTribe(actor:string,code:unknown){
 const reference=vault(actor);
 const verifier=await createTribeVerifier(code);
 await adminDb.runTransaction(async tx=>{
  const [account,existing]=await Promise.all([tx.get(adminDb.doc('users/'+actor)),tx.get(reference)]);
  if(!account.exists||existing.exists)throw Error('TRIBE_SETUP_UNAVAILABLE');
  tx.create(reference,{...verifier,failures:0,lockedUntil:0,sessionDigest:'',sessionExpiresAt:0,createdAt:FieldValue.serverTimestamp(),updatedAt:FieldValue.serverTimestamp()});
 });
}
export async function unlockReservedTribe(actor:string,code:unknown){
 const reference=vault(actor);
 if(!validTribeCode(code))return {ok:false as const};
 return adminDb.runTransaction(async tx=>{
  const snapshot=await tx.get(reference);
  if(!snapshot.exists)return {ok:false as const};
  const row=snapshot.data()!;
  const now=Date.now();
  const attempt:TribeAttemptState={failures:Number.isSafeInteger(row.failures)?row.failures:0,lockedUntil:Number.isSafeInteger(row.lockedUntil)?row.lockedUntil:0};
  if(tribeAttemptLocked(attempt,now))return {ok:false as const,lockedUntil:attempt.lockedUntil};
  const verifier:TribeVerifier={salt:typeof row.salt==='string'?row.salt:'',digest:typeof row.digest==='string'?row.digest:''};
  if(!await verifyTribeCode(code,verifier)){
   const next=failedTribeAttempt(attempt,now);
   tx.update(reference,{...next,updatedAt:FieldValue.serverTimestamp()});
   return {ok:false as const,...(next.lockedUntil?{lockedUntil:next.lockedUntil}:{})};
  }
  const session=issueTribeSession(Date.now());
  // One short-lived capability per account. A new unlock invalidates the previous session.
  tx.update(reference,{failures:0,lockedUntil:0,sessionDigest:session.digest,sessionExpiresAt:session.expiresAt,updatedAt:FieldValue.serverTimestamp()});
  return {ok:true as const,token:session.token,expiresAt:session.expiresAt};
 });
}
export async function hasReservedTribeSession(actor:string,token:unknown){
 const row=(await vault(actor).get()).data();
 return !!row&&validTribeSession(token,row.sessionDigest,row.sessionExpiresAt,Date.now());
}
export async function lockReservedTribe(actor:string){
 const reference=vault(actor);
 await adminDb.runTransaction(async tx=>{
  if((await tx.get(reference)).exists)tx.update(reference,{sessionDigest:'',sessionExpiresAt:0,updatedAt:FieldValue.serverTimestamp()});
 });
}
