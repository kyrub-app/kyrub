import {adminDb,getFirebaseAdminProjectId} from '../firebaseAdmin.js';
import {validFreelanceId} from '../../shared/freelanceLifecycle.js';
import type {FreelancePaymentObligation} from '../../shared/freelancePaymentObligation.js';
import {projectExternalPixStatements,type ExternalPixEvent} from '../../shared/freelanceExternalPaymentStatements.js';

/** One private restriction per dispute and participant. A parent document acts
 * as the serialization point for every new engagement and restriction change.
 * No account ban, automatic culpability, or bank settlement.
 */
const root=(uid:string)=>adminDb.doc('freelanceEngagementRestrictionsV1/'+uid);
function assertLocal(){
 if(process.env.VERCEL||process.env.VERCEL_ENV||process.env.FIREBASE_SERVICE_ACCOUNT_JSON||process.env.GOOGLE_APPLICATION_CREDENTIALS||
 !/^(127\.0\.0\.1|localhost):8088$/.test(process.env.FIRESTORE_EMULATOR_HOST??'')||
 getFirebaseAdminProjectId()!=='kyrub-security-test')throw Error('FREELANCE_DIRECT_PAYMENT_NOT_ENABLED');
}
function readIds(raw:unknown,uid:string):string[]{
 if(raw===undefined)return [];
 if(!raw||typeof raw!=='object'||Array.isArray(raw))throw Error('FREELANCE_RESTRICTION_CONFLICT');
 const r=raw as {schemaVersion:unknown;uid:unknown;openOfferIds:unknown};
 if(Object.keys(r).length!==3||r.schemaVersion!==1||r.uid!==uid||!Array.isArray(r.openOfferIds)||
 !r.openOfferIds.every(validFreelanceId)||new Set(r.openOfferIds).size!==r.openOfferIds.length)throw Error('FREELANCE_RESTRICTION_CONFLICT');
 return r.openOfferIds;
}
export async function assertFreelanceEngagementAllowed(tx:FirebaseFirestore.Transaction,...uids:string[]){
 const unique=[...new Set(uids)];
 if(!unique.every(validFreelanceId))throw Error('FREELANCE_INVALID');
 const records=await tx.getAll(...unique.map(root));
 for(let i=0;i<unique.length;i++){
  if(readIds(records[i].data(),unique[i]).length)throw Error('FREELANCE_FINANCIAL_RESTRICTION');
 }
}
/** Prepare writes using authoritative obligation and append-only statements.
 * Called only by server settlement transaction; all reads before any writes.
 * This helper is not an API and is not an administrative resolution.
 */
export async function prepareVoluntaryDisputeRestriction(tx:FirebaseFirestore.Transaction,obligation:FreelancePaymentObligation,before:readonly ExternalPixEvent[],after:readonly ExternalPixEvent[]){
 assertLocal();
 if(!validFreelanceId(obligation.offerId))throw Error('FREELANCE_INVALID');
 const prev=projectExternalPixStatements(obligation,before),next=projectExternalPixStatements(obligation,after);
 if(after.length!==before.length+1||before.some((e,i)=>JSON.stringify(e)!==JSON.stringify(after[i])))throw Error('FREELANCE_RESTRICTION_CONFLICT');
 const opening=prev.state!=='disputed'&&next.state==='disputed';
 const closing=prev.state==='disputed'&&next.state==='bilaterally_reported_received';
 if(!opening&&!closing)return ()=>{};
 const ids=[obligation.requesterUid,obligation.beneficiaryUid];
 const refs=ids.map(root),docs=await tx.getAll(...refs);
 const updates=docs.map((d,i)=>{
  const open=readIds(d.data(),ids[i]),has=open.includes(obligation.offerId);
  if(opening?has:!has)throw Error('FREELANCE_RESTRICTION_CONFLICT');
  return {schemaVersion:1,uid:ids[i],openOfferIds:opening?[...open,obligation.offerId].sort():open.filter(id=>id!==obligation.offerId)};
 });
 return ()=>{for(let i=0;i<refs.length;i++)tx.set(refs[i],updates[i]);};
}

/** Server-only consistency check; a missing bilateral restriction is not a valid pending review. */
export async function assertFinancialCaseRestrictions(tx:FirebaseFirestore.Transaction,obligation:FreelancePaymentObligation,expected=true){
 assertLocal();
 const ids=[obligation.requesterUid,obligation.beneficiaryUid];
 const docs=await tx.getAll(...ids.map(root));
 if(docs.some((d,i)=>readIds(d.data(),ids[i]).includes(obligation.offerId)!==expected))throw Error('FREELANCE_RESTRICTION_CONFLICT');
}

/** Only the authorized administrative decision transaction may invoke this closure.
 * Remove this specific case, never the user's entire restriction record. */
export async function prepareAdministrativeDisputeRelease(tx:FirebaseFirestore.Transaction,obligation:FreelancePaymentObligation){
 assertLocal();
 const ids=[obligation.requesterUid,obligation.beneficiaryUid],refs=ids.map(root),docs=await tx.getAll(...refs);
 const updates=docs.map((d,i)=>{
  const open=readIds(d.data(),ids[i]);
  if(!open.includes(obligation.offerId))throw Error('FREELANCE_RESTRICTION_CONFLICT');
  return {schemaVersion:1,uid:ids[i],openOfferIds:open.filter(id=>id!==obligation.offerId)};
 });
 return ()=>{for(let i=0;i<refs.length;i++)tx.set(refs[i],updates[i]);};
}

/** Own private restriction summary; never reveals other participants. */
export async function readOwnFreelanceRestrictions(uid:string){
 assertLocal();
 if(!validFreelanceId(uid))throw Error('FREELANCE_FORBIDDEN');
 const ids=readIds((await root(uid).get()).data(),uid);
 return {restricted:ids.length>0,openOfferIds:ids};
}
