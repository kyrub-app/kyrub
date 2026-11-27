import {createHash} from 'node:crypto';
import {adminDb,getFirebaseAdminProjectId} from '../firebaseAdmin.js';
import {validFreelanceId} from '../../shared/freelanceLifecycle.js';
import {calculateCancellationAccounting} from '../../shared/freelanceCancellationAccounting.js';
import {readFinancialContext,checkedReview} from './freelanceExternalPaymentStatementService.js';
import {assertFinancialCaseRestrictions} from './freelanceEngagementRestrictionService.js';

const conflict=():never=>{throw Error('FREELANCE_CANCELLATION_ACCOUNTING_CONFLICT');};
function assertLocal(){
 if(process.env.KYRUB_FREELANCE_LOCAL_HOMOLOGATION!=='true'||process.env.KYRUB_PERSONAL_FINANCE_LOCAL_HOMOLOGATION!=='true'||
 process.env.VERCEL||process.env.VERCEL_ENV||process.env.FIREBASE_SERVICE_ACCOUNT_JSON||process.env.GOOGLE_APPLICATION_CREDENTIALS||
 process.env.FIRESTORE_EMULATOR_HOST!=='127.0.0.1:8088'||process.env.FIREBASE_AUTH_EMULATOR_HOST!=='127.0.0.1:9099'||
 getFirebaseAdminProjectId()!=='kyrub-security-test')throw Error('FREELANCE_DIRECT_PAYMENT_NOT_ENABLED');
}
type Accounting=ReturnType<typeof calculateCancellationAccounting>;
type Proposal={schemaVersion:1;offerId:string;id:string;proposedBy:string;proposedAt:string;snapshot:string;
 recognizedServiceMinor:number;reportedReceivedMinor:number;status:'pending'|'accepted'|'closed';decidedBy?:string;decidedAt?:string};
async function context(tx:FirebaseFirestore.Transaction,uid:string,id:string){
 const reviewDoc=await tx.get(adminDb.doc('freelanceFinancialReviewsV1/'+id));
 const c=await readFinancialContext(tx,uid,id,true);
 if(c.offer.status!=='cancelled'||!c.offer.cancelledAt)return conflict();
 const review=checkedReview(reviewDoc.data(),c.obligation);
 const restricted=c.projection.state==='disputed'&&review?.status!=='resolved_administratively';
 await assertFinancialCaseRestrictions(tx,c.obligation,restricted);
 const eligible=!restricted&&review?.status!=='pending'&&['awaiting_payment','nonreceipt_reported','bilaterally_reported_received'].includes(c.projection.state);
 const snapshot=createHash('sha256').update(JSON.stringify([c.obligation,c.offer.cancelledAt,c.events,review??null])).digest('hex');
 const direct=adminDb.doc('freelanceOffersV1/'+id).collection('directPayment');
 const pointer=direct.doc('cancellationAccounting');
 const raw=(await tx.get(pointer)).data();
 let proposal:Proposal|undefined;
 if(raw){
  if(Object.keys(raw).length!==2||raw.schemaVersion!==1||!validFreelanceId(raw.proposalId))return conflict();
  proposal=(await tx.get(direct.doc('cancellationAccounting-'+raw.proposalId))).data() as Proposal|undefined;
  if(!proposal||proposal.id!==raw.proposalId||proposal.schemaVersion!==1||proposal.offerId!==id||
   ![c.obligation.requesterUid,c.obligation.beneficiaryUid].includes(proposal.proposedBy)||
   !Number.isFinite(Date.parse(proposal.proposedAt))||Date.parse(proposal.proposedAt)<Date.parse(c.offer.cancelledAt)||
   typeof proposal.snapshot!=='string'||!/^[a-f0-9]{64}$/.test(proposal.snapshot)||
   !['pending','accepted','closed'].includes(proposal.status)||Object.keys(proposal).length!==(proposal.status==='pending'?9:11)||
   ![proposal.recognizedServiceMinor,proposal.reportedReceivedMinor].every(v=>Number.isSafeInteger(v)&&v>=0&&v<=c.obligation.terms.amountMinor)||
   (proposal.status!=='pending'&&(![c.obligation.requesterUid,c.obligation.beneficiaryUid].includes(proposal.decidedBy!)||
    !Number.isFinite(Date.parse(proposal.decidedAt!))||Date.parse(proposal.decidedAt!)<Date.parse(proposal.proposedAt)||
    (proposal.status==='accepted'&&proposal.decidedBy===proposal.proposedBy))))return conflict();
 }
 const stale=!!proposal&&proposal.snapshot!==snapshot;
 return {...c,direct,pointer,proposal,snapshot,stale,eligible};
}
function project(c:Awaited<ReturnType<typeof context>>,uid:string){
 const p=c.proposal;
 const amounts:Accounting|null=p&&!c.stale&&c.eligible&&p.status!=='closed'?calculateCancellationAccounting(c.obligation,c.events,p.recognizedServiceMinor,p.reportedReceivedMinor):null;
 return {offerId:c.offer.id,currency:'BRL',agreedMinor:c.obligation.terms.amountMinor,
  priorPaymentState:c.projection.state,eligible:c.eligible,bankVerified:false,settlement:'not_verified',
  proposal:p?{id:p.id,status:c.stale?'stale':p.status,proposedByMe:p.proposedBy===uid,proposedAt:p.proposedAt,amounts}:null};
}
export async function readCancellationAccounting(uid:string,id:string){
 assertLocal();if(!validFreelanceId(uid)||!validFreelanceId(id))throw Error('FREELANCE_INVALID');
 return adminDb.runTransaction(async tx=>project(await context(tx,uid,id),uid),{readOnly:true});
}
/** Either participant may propose, only the other may accept. A closed or
 * stale proposal may be replaced, with previous records retained. No release
 * of restrictions, financial posting, transfer, or new payment authority. */
export async function changeCancellationAccounting(uid:string,id:string,action:'propose'|'accept'|'close',input:unknown){
 assertLocal();
 if(!validFreelanceId(uid)||!validFreelanceId(id)||!input||typeof input!=='object'||Array.isArray(input))throw Error('FREELANCE_INVALID');
 const b=input as Record<string,unknown>;
 const fields=action==='propose'?['proposalId','recognizedServiceMinor','reportedReceivedMinor','confirmed']:['proposalId','confirmed'];
 if(!['propose','accept','close'].includes(action)||Object.keys(b).length!==fields.length||Object.keys(b).some(k=>!fields.includes(k))||!validFreelanceId(b.proposalId)||b.confirmed!==true)throw Error('FREELANCE_INVALID');
 const proposalId=b.proposalId;
 return adminDb.runTransaction(async tx=>{
  const c=await context(tx,uid,id),p=c.proposal;
  const now=new Date().toISOString();
  if(Date.parse(now)<Date.parse(c.offer.cancelledAt!))return conflict();
  if(action==='propose'){
   if(!c.eligible)return conflict();
   const a=calculateCancellationAccounting(c.obligation,c.events,b.recognizedServiceMinor,b.reportedReceivedMinor);
   if(p?.id===proposalId){
    if(c.stale||p.proposedBy!==uid||p.recognizedServiceMinor!==a.recognizedServiceMinor||p.reportedReceivedMinor!==a.reportedReceivedMinor)return conflict();
    return {changed:false};
   }
   if(p&&!c.stale&&p.status!=='closed')return conflict();
   const ref=c.direct.doc('cancellationAccounting-'+proposalId);
   if((await tx.get(ref)).exists)return conflict();
   const proposal:Proposal={schemaVersion:1,id:proposalId,offerId:id,proposedBy:uid,proposedAt:now,snapshot:c.snapshot,
    recognizedServiceMinor:a.recognizedServiceMinor,reportedReceivedMinor:a.reportedReceivedMinor,status:'pending'};
   tx.create(ref,proposal);tx.set(c.pointer,{schemaVersion:1,proposalId});
   return {changed:true};
  }
  if(!p||p.id!==proposalId||c.stale)return conflict();
  const status=action==='accept'?'accepted':'closed';
  if(p.status===status&&p.decidedBy===uid)return {changed:false};
  if(p.status!=='pending'||Date.parse(now)<Date.parse(p.proposedAt))return conflict();
  if(action==='accept'){
   if(!c.eligible||uid===p.proposedBy)return conflict();
   calculateCancellationAccounting(c.obligation,c.events,p.recognizedServiceMinor,p.reportedReceivedMinor);
  }
  tx.update(c.direct.doc('cancellationAccounting-'+proposalId),{status,decidedBy:uid,decidedAt:now});
  return {changed:true};
 });
}
