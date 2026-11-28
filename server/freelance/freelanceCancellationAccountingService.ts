import {buildFixedCancellationResolution,readFixedResolutionRecords,writeFixedResolution} from './freelanceFixedCancellationResolution.js';
import {digestVariablePaymentSources} from './freelanceVariablePaymentBasisService.js';
import {readHourlyReviewNotes} from './freelanceHourlyReviewNotes.js';
import {writeFreelanceFinancialNotices} from './freelanceFinancialNoticeService.js';
import {createHash} from 'node:crypto';
import {adminDb,getFirebaseAdminProjectId} from '../firebaseAdmin.js';
import {validFreelanceId} from '../../shared/freelanceLifecycle.js';
import {calculateCancellationAccounting} from '../../shared/freelanceCancellationAccounting.js';
import {readFinancialContext,checkedReview} from './freelanceExternalPaymentStatementService.js';
import {assertFinancialCaseRestrictions,prepareCancellationRestriction} from './freelanceEngagementRestrictionService.js';

const conflict=():never=>{throw Error('FREELANCE_CANCELLATION_ACCOUNTING_CONFLICT');};
function assertLocal(){
 if(process.env.KYRUB_FREELANCE_LOCAL_HOMOLOGATION!=='true'||process.env.KYRUB_PERSONAL_FINANCE_LOCAL_HOMOLOGATION!=='true'||
 process.env.VERCEL||process.env.VERCEL_ENV||process.env.FIREBASE_SERVICE_ACCOUNT_JSON||process.env.GOOGLE_APPLICATION_CREDENTIALS||
 process.env.FIRESTORE_EMULATOR_HOST!=='127.0.0.1:8088'||process.env.FIREBASE_AUTH_EMULATOR_HOST!=='127.0.0.1:9099'||
 getFirebaseAdminProjectId()!=='kyrub-security-test')throw Error('FREELANCE_DIRECT_PAYMENT_NOT_ENABLED');
}
type Accounting=ReturnType<typeof calculateCancellationAccounting>;
export type FixedCancellationDecision={actorUid:string;recognizedServiceMinor:number;reportedReceivedMinor:number;reason:string;decidedAt:string;snapshot:string;proposalDigest:string;evidenceDigest:string};
type Proposal={schemaVersion:1;offerId:string;id:string;proposedBy:string;proposedAt:string;snapshot:string;
 recognizedServiceMinor:number;reportedReceivedMinor:number;status:'pending'|'accepted'|'closed';decidedBy?:string;decidedAt?:string};
export async function readFixedCancellationContext(tx:FirebaseFirestore.Transaction,uid:string,id:string){
 const reviewDoc=await tx.get(adminDb.doc('freelanceFinancialReviewsV1/'+id));
 const c=await readFinancialContext(tx,uid,id,true);
 if(c.offer.workTerms?.mode==='hourly'||c.offer.status!=='cancelled'||!c.offer.cancelledAt)return conflict();
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
 const disputeRef=direct.doc('fixedCancellationDispute'),dispute=(await tx.get(disputeRef)).data() as {schemaVersion:1;offerId:string;openedBy:string;openedAt:string;status:'open'|'review_requested'|'resolved_voluntarily'|'resolved_administratively';decision?:FixedCancellationDecision;sourceProposalId:string;requestedAt?:string;requestedBy?:string;resolvedAt?:string;agreementId?:string}|undefined;
 if(dispute){
  const parties=[c.obligation.requesterUid,c.obligation.beneficiaryUid],requested=dispute.requestedAt!==undefined||dispute.requestedBy!==undefined;
  if(dispute.schemaVersion!==1||dispute.offerId!==id||!parties.includes(dispute.openedBy)||!validFreelanceId(dispute.sourceProposalId)||!Number.isFinite(Date.parse(dispute.openedAt))||Date.parse(dispute.openedAt)<Date.parse(c.offer.cancelledAt)||!['open','review_requested','resolved_voluntarily','resolved_administratively'].includes(dispute.status)||Object.keys(dispute).length!==6+(requested?2:0)+(dispute.status==='resolved_voluntarily'?2:dispute.status==='resolved_administratively'?1:0)||(requested&&(!parties.includes(dispute.requestedBy!)||!Number.isFinite(Date.parse(dispute.requestedAt!))||Date.parse(dispute.requestedAt!)<Date.parse(dispute.openedAt)))||(dispute.status==='open'&&requested)||(['review_requested','resolved_administratively'].includes(dispute.status)&&!requested)||(dispute.status==='resolved_voluntarily'?(!proposal||proposal.status!=='accepted'||dispute.agreementId!==proposal.id||dispute.resolvedAt!==proposal.decidedAt):proposal?.status==='accepted'&&!stale))return conflict();
  const rejected=(await tx.get(direct.doc('cancellationAccounting-'+dispute.sourceProposalId))).data() as Proposal|undefined;
  if(!rejected||rejected.offerId!==id||rejected.id!==dispute.sourceProposalId||rejected.status!=='closed'||!rejected.decidedBy||rejected.proposedBy===rejected.decidedBy||!parties.includes(rejected.decidedBy)||!parties.includes(rejected.proposedBy)||!Number.isFinite(Date.parse(rejected.decidedAt!))||Date.parse(rejected.decidedAt!)>Date.parse(dispute.openedAt))return conflict();
 }
 const cancellationRestricted=!!dispute&&['open','review_requested'].includes(dispute.status);
 const queueRef=adminDb.doc('freelanceFixedCancellationReviewsV1/'+id),queue=(await tx.get(queueRef)).data();
 if(dispute?.requestedAt){
  if(!queue||Object.keys(queue).length!==6||queue.offerId!==id||queue.requesterUid!==c.obligation.requesterUid||queue.beneficiaryUid!==c.obligation.beneficiaryUid||queue.requestedAt!==dispute.requestedAt||queue.sourceProposalId!==dispute.sourceProposalId||queue.status!==(cancellationRestricted?'pending':dispute.status))return conflict();
 }else if(queue)return conflict();
 // Evidence binds to the original escalation, not the mutable payment snapshot.
 const evidenceSource=digestVariablePaymentSources({offerId:id,sourceProposalId:dispute?.sourceProposalId??null,requestedAt:dispute?.requestedAt??null});
 const evidence=await readHourlyReviewNotes(tx,queueRef,c.obligation,evidenceSource,dispute?.requestedAt);
 let administrativeAmounts:Accounting|null=null;
 if(dispute?.status==='resolved_administratively'){
  const d=dispute.decision;
  if(!d||Object.keys(d).length!==8||!validFreelanceId(d.actorUid)||[c.obligation.requesterUid,c.obligation.beneficiaryUid].includes(d.actorUid)||typeof d.reason!=='string'||d.reason.trim()!==d.reason||d.reason.length<10||d.reason.length>1000||!Number.isFinite(Date.parse(d.decidedAt))||Date.parse(d.decidedAt)<Date.parse(dispute.requestedAt!)||d.snapshot!==snapshot||d.proposalDigest!==digestVariablePaymentSources(proposal??null)||d.evidenceDigest!==evidence.digest)return conflict();
  administrativeAmounts=calculateCancellationAccounting(c.obligation,c.events,d.recognizedServiceMinor,d.reportedReceivedMinor);
 }
 const resolutionBase={obligation:c.obligation,events:c.events,snapshot,cancelledAt:c.offer.cancelledAt};
 const resolved=dispute?.status==='resolved_administratively'?buildFixedCancellationResolution({...resolutionBase,kind:'administrative',resolvedAt:dispute.decision!.decidedAt,recognizedServiceMinor:dispute.decision!.recognizedServiceMinor,reportedReceivedMinor:dispute.decision!.reportedReceivedMinor,decision:dispute.decision}):proposal?.status==='accepted'?buildFixedCancellationResolution({...resolutionBase,kind:'bilateral',resolvedAt:proposal.decidedAt!,recognizedServiceMinor:proposal.recognizedServiceMinor,reportedReceivedMinor:proposal.reportedReceivedMinor,decision:proposal}):null;
 if(resolved&&(stale&&proposal?.status==='accepted'||!eligible||cancellationRestricted))return conflict();
 const resolutionRecords=await readFixedResolutionRecords(tx,direct,resolved);
 await prepareCancellationRestriction(tx,c.obligation,cancellationRestricted,cancellationRestricted);
 return {...c,direct,pointer,proposal,snapshot,stale,eligible,dispute,disputeRef,cancellationRestricted,queueRef,evidence,evidenceSource,administrativeAmounts,resolved,resolutionRecords,resolutionBase};
}
function project(c:Awaited<ReturnType<typeof readFixedCancellationContext>>,uid:string){
 const p=c.proposal;
 const amounts:Accounting|null=p&&!c.stale&&c.eligible&&p.status!=='closed'?calculateCancellationAccounting(c.obligation,c.events,p.recognizedServiceMinor,p.reportedReceivedMinor):null;
 return {offerId:c.offer.id,currency:'BRL',agreedMinor:c.obligation.terms.amountMinor,
  priorPaymentState:c.projection.state,eligible:c.eligible,resolution:c.resolved?.resolution??null,snapshot:c.snapshot,restrictionActive:c.cancellationRestricted,dispute:c.dispute?{status:c.dispute.status,requestedAt:c.dispute.requestedAt??null,...(c.dispute.decision?{decision:{reason:c.dispute.decision.reason,decidedAt:c.dispute.decision.decidedAt,amounts:c.administrativeAmounts}}:{})}:null,evidenceSource:c.dispute?.requestedAt?c.evidenceSource:null,bankVerified:false,settlement:'not_verified',
  proposal:p?{id:p.id,status:c.stale?'stale':p.status,proposedByMe:p.proposedBy===uid,proposedAt:p.proposedAt,closure:p.status==='closed'?(p.decidedBy===p.proposedBy?'withdrawn':'declined'):null,amounts}:null};
}
export async function readCancellationAccounting(uid:string,id:string){
 assertLocal();if(!validFreelanceId(uid)||!validFreelanceId(id))throw Error('FREELANCE_INVALID');
 return adminDb.runTransaction(async tx=>project(await readFixedCancellationContext(tx,uid,id),uid),{readOnly:true});
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
  const c=await readFixedCancellationContext(tx,uid,id),p=c.proposal;
  if(c.dispute?.status==='resolved_administratively')return conflict();
  const now=new Date().toISOString();
  if(Date.parse(now)<Date.parse(c.offer.cancelledAt!))return conflict();
  if(action==='propose'){
   if(!c.eligible||c.dispute?.status==='resolved_voluntarily')return conflict();
   const a=calculateCancellationAccounting(c.obligation,c.events,b.recognizedServiceMinor,b.reportedReceivedMinor);
   if(p?.id===proposalId){
    if(c.stale||p.proposedBy!==uid||p.recognizedServiceMinor!==a.recognizedServiceMinor||p.reportedReceivedMinor!==a.reportedReceivedMinor)return conflict();
    return {changed:false};
   }
   if(c.resolved||p&&!c.stale&&p.status!=='closed')return conflict();
   const ref=c.direct.doc('cancellationAccounting-'+proposalId);
   if((await tx.get(ref)).exists)return conflict();
   const proposal:Proposal={schemaVersion:1,id:proposalId,offerId:id,proposedBy:uid,proposedAt:now,snapshot:c.snapshot,
    recognizedServiceMinor:a.recognizedServiceMinor,reportedReceivedMinor:a.reportedReceivedMinor,status:'pending'};
   tx.create(ref,proposal);tx.set(c.pointer,{schemaVersion:1,proposalId});
   writeFreelanceFinancialNotices(tx,c.obligation,'cancellation_accounting_proposed',now,uid===c.obligation.requesterUid?'freelancer':'requester',proposalId);
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
  const release=action==='accept'&&c.cancellationRestricted?await prepareCancellationRestriction(tx,c.obligation,true,false):()=>{};
  if(action==='accept'&&c.cancellationRestricted){if(!c.dispute||Date.parse(now)<Date.parse(c.dispute.requestedAt??c.dispute.openedAt))return conflict();tx.update(c.disputeRef,{status:'resolved_voluntarily',resolvedAt:now,agreementId:p.id});if(c.dispute.requestedAt)tx.update(c.queueRef,{status:'resolved_voluntarily'});release();}
  if(action==='accept'){
   const decision={...p,status:'accepted',decidedBy:uid,decidedAt:now};
   const result=buildFixedCancellationResolution({...c.resolutionBase,kind:'bilateral',resolvedAt:now,recognizedServiceMinor:p.recognizedServiceMinor,reportedReceivedMinor:p.reportedReceivedMinor,decision});
   writeFixedResolution(tx,c.resolutionRecords,result);
  }
  tx.update(c.direct.doc('cancellationAccounting-'+proposalId),{status,decidedBy:uid,decidedAt:now});
  writeFreelanceFinancialNotices(tx,c.obligation,action==='accept'?'cancellation_accounting_accepted':'cancellation_accounting_closed',now,uid===c.obligation.requesterUid?'freelancer':'requester',proposalId);
  return {changed:true};
 });
}

export async function changeFixedCancellationDispute(uid:string,id:string,action:'open'|'request_review',input:{snapshot:unknown;confirmed:unknown}){
 assertLocal();
 if(!validFreelanceId(uid)||!validFreelanceId(id)||input.confirmed!==true||typeof input.snapshot!=='string'||!/^[a-f0-9]{64}$/.test(input.snapshot))throw Error('FREELANCE_INVALID');
 return adminDb.runTransaction(async tx=>{
  const c=await readFixedCancellationContext(tx,uid,id),p=c.proposal;
  if(input.snapshot!==c.snapshot||!c.eligible)return conflict();
  const now=new Date().toISOString();
  if(action==='open'){
   if(c.dispute){if(c.cancellationRestricted&&c.dispute.openedBy===uid)return {changed:false};return conflict();}
   if(!p||c.stale||p.status!=='closed'||p.decidedBy===p.proposedBy||!p.decidedAt||Date.parse(now)<Date.parse(p.decidedAt))return conflict();
   const write=await prepareCancellationRestriction(tx,c.obligation,false,true);
   tx.create(c.disputeRef,{schemaVersion:1,offerId:id,openedBy:uid,openedAt:now,status:'open',sourceProposalId:p.id});
   write();writeFreelanceFinancialNotices(tx,c.obligation,'fixed_cancellation_disputed',now,'both','dispute');return {changed:true};
  }
  if(!c.dispute||!c.cancellationRestricted)return conflict();
  if(c.dispute.status==='review_requested'){if(c.dispute.requestedBy===uid)return {changed:false};return conflict();}
  if(c.dispute.status!=='open'||Date.parse(now)<Date.parse(c.dispute.openedAt))return conflict();
  tx.update(c.disputeRef,{status:'review_requested',requestedAt:now,requestedBy:uid});
  tx.create(c.queueRef,{offerId:id,requesterUid:c.obligation.requesterUid,beneficiaryUid:c.obligation.beneficiaryUid,requestedAt:now,sourceProposalId:c.dispute.sourceProposalId,status:'pending'});
  writeFreelanceFinancialNotices(tx,c.obligation,'fixed_cancellation_review_requested',now,'both','dispute');return {changed:true};
 });
}
