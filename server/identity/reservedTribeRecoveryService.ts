import {FieldValue} from 'firebase-admin/firestore';
import {adminAuth,adminDb} from '../firebaseAdmin.js';
import {createTribeVerifier,validTribeCode,validTribeRecoveryProof} from './reservedTribeSecurity.js';

type VerifiedRecoveryIdentity={uid:string;email_verified?:boolean;auth_time:number};
type VerifyRecoveryIdentity=(token:string)=>Promise<VerifiedRecoveryIdentity>;

/** Server-side only. Production uses Firebase Admin verification with
 * revocation checking; the injected verifier exists for isolated testing.
 * No client-supplied uid, auth_time, email verification or prior code.
 */
export function createReservedTribeRecoveryService(verifyIdentity:VerifyRecoveryIdentity){
 return async function recoverReservedTribeCode(idToken:unknown,newCode:unknown,confirmation:unknown){
  if(typeof idToken!=='string'||!idToken||idToken.length>8192)throw Error('TRIBE_RECOVERY_DENIED');
  if(!validTribeCode(newCode)||newCode!==confirmation)throw Error('TRIBE_CODE_INVALID');
  let identity:VerifiedRecoveryIdentity;
  try{identity=await verifyIdentity(idToken);}catch{throw Error('TRIBE_RECOVERY_DENIED');}
  const actor=identity.uid;
  if(typeof actor!=='string'||!(/^[A-Za-z0-9_-]{1,128}$/.test(actor))||
     !validTribeRecoveryProof(identity,actor,0,Date.now()))throw Error('TRIBE_RECOVERY_DENIED');
  const verifier=await createTribeVerifier(newCode);
  const root=adminDb.doc('reserved_tribe_vaults/'+actor);
  await adminDb.runTransaction(async tx=>{
   const [account,config]=await Promise.all([tx.get(adminDb.doc('users/'+actor)),tx.get(root)]);
   if(!account.exists||!config.exists||!validTribeRecoveryProof(identity,actor,config.get('lastRecoveryAuthTime'),Date.now()))
    throw Error('TRIBE_RECOVERY_DENIED');
   // Overwrite only credentials and session state; never touch membership,
   // directoryProtected, favorites, notification state or shared messages.
   tx.update(root,{...verifier,failures:0,lockedUntil:0,sessionDigest:'',sessionExpiresAt:0,
    lastRecoveryAuthTime:identity.auth_time,updatedAt:FieldValue.serverTimestamp()});
  });
  return {recovered:true as const};
 };
}
export const recoverReservedTribeCode=createReservedTribeRecoveryService(async token=>{
 const identity=await adminAuth.verifyIdToken(token,true);
 // verifyIdToken(checkRevoked=true) rejects disabled users and revoked tokens.
 return {uid:identity.uid,email_verified:identity.email_verified,auth_time:identity.auth_time};
});
