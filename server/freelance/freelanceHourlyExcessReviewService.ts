import {readHourlyReviewNotes} from './freelanceHourlyReviewNotes.js';
import {prepareExcessRestriction} from './freelanceEngagementRestrictionService.js';
import type {Transaction} from 'firebase-admin/firestore';
import {adminDb} from '../firebaseAdmin.js';
import {validFreelanceId} from '../../shared/freelanceLifecycle.js';
import {calculateHourlyExcessResolution} from '../../shared/freelanceHourlyExcessResolution.js';
import {readVariablePaymentSources,digestVariablePaymentSources,canonicalVariablePaymentRecord} from './freelanceVariablePaymentBasisService.js';
import {writeFreelanceFinancialNotices} from './freelanceFinancialNoticeService.js';
const fail=():never=>{throw Error('FREELANCE_VARIABLE_PAYMENT_CONFLICT');};
type Role='worker'|'requester';
type Proposal={schemaVersion:1;id:string;sourceDigest:string;recognizedExcessMs:number;proposedBy:Role;proposedAt:string;status:'pending'|'accepted'|'declined'|'withdrawn';decidedBy?:Role;decidedAt?:string};
const iso=(v:unknown):v is string=>typeof v==='string'&&Number.isFinite(Date.parse(v))&&new Date(Date.parse(v)).toISOString()===v;
export async function readHourlyExcessContext(tx:Transaction,uid:string,id:string){
 const s=await readVariablePaymentSources(tx,uid,id),{record,c}=s;
 if(!s.savedBasis.exists||!s.savedCommitment.exists||record.disposition!=='requires_review'||record.accounting.status!=='requires_excess_review')return fail();
 const direct=c.ref.collection('directPayment'),pointer=direct.doc('hourlyExcessAgreement'),resolutionRef=direct.doc('hourlyExcessResolution');
 const [pdoc,resolution,final,history]=await tx.getAll(pointer,resolutionRef,direct.doc('hourlyFinalObligation'),direct.doc('hourlyStatements'));

 const raw=pdoc.data();let proposal:Proposal|null=null;
 if(raw){
  if(Object.keys(raw).length!==2||raw.schemaVersion!==1||!validFreelanceId(raw.proposalId))return fail();
  proposal=((await tx.get(direct.doc('hourlyExcessAgreement-'+raw.proposalId))).data() as Proposal|undefined)??null;
  if(!proposal||Object.keys(proposal).length!==(proposal.status==='pending'?7:9)||proposal.schemaVersion!==1||proposal.id!==raw.proposalId||proposal.sourceDigest!==record.sourceDigest||!['worker','requester'].includes(proposal.proposedBy)||!iso(proposal.proposedAt)||Date.parse(proposal.proposedAt)<Date.parse(record.completedAt)||!['pending','accepted','declined','withdrawn'].includes(proposal.status))return fail();
  calculateHourlyExcessResolution(record,proposal.recognizedExcessMs);
  if(proposal.status==='pending'){if(proposal.decidedAt!==undefined||proposal.decidedBy!==undefined)return fail();}
  else if(!iso(proposal.decidedAt)||Date.parse(proposal.decidedAt)<Date.parse(proposal.proposedAt)||!['worker','requester'].includes(proposal.decidedBy??'')||(proposal.status==='withdrawn'?proposal.decidedBy!==proposal.proposedBy:proposal.decidedBy===proposal.proposedBy))return fail();
 }
 let resolved=proposal?.status==='accepted'?buildResolution(record,proposal):null;
 const disputeRef=direct.doc('hourlyExcessDispute'),dispute=(await tx.get(disputeRef)).data() as {schemaVersion:1;sourceDigest:string;openedBy:Role;openedAt:string;status:'open'|'review_requested'|'resolved_voluntarily'|'resolved_administratively';decision?:HourlyExcessAdminDecision;requestedAt?:string;requestedBy?:Role;resolvedAt?:string;agreementId?:string}|undefined;
 if(dispute){
  const requested=dispute.requestedAt!==undefined||dispute.requestedBy!==undefined;
  if(dispute.schemaVersion!==1||dispute.sourceDigest!==record.sourceDigest||!['worker','requester'].includes(dispute.openedBy)||!iso(dispute.openedAt)||Date.parse(dispute.openedAt)<Date.parse(record.completedAt)||!['open','review_requested','resolved_voluntarily','resolved_administratively'].includes(dispute.status)||Object.keys(dispute).length!==5+(requested?2:0)+(dispute.status==='resolved_voluntarily'?2:dispute.status==='resolved_administratively'?1:0)||(requested&&(!iso(dispute.requestedAt)||Date.parse(dispute.requestedAt)<Date.parse(dispute.openedAt)||!['worker','requester'].includes(dispute.requestedBy??'')))||(dispute.status==='open'&&requested)||(['review_requested','resolved_administratively'].includes(dispute.status)&&!requested)||(dispute.status==='resolved_voluntarily'?(!resolved||dispute.agreementId!==proposal?.id||dispute.resolvedAt!==proposal?.decidedAt||!iso(dispute.resolvedAt)||Date.parse(dispute.resolvedAt)<Date.parse(dispute.requestedAt??dispute.openedAt)):!!resolved))return fail();
 }
 if(dispute?.status==='resolved_administratively'){
  const d=dispute.decision;
  if(!d||Object.keys(d).length!==6||!validFreelanceId(d.actorUid)||[record.commitment.requesterUid,record.commitment.beneficiaryUid].includes(d.actorUid)||typeof d.reason!=='string'||d.reason.trim()!==d.reason||d.reason.length<10||d.reason.length>1000||!iso(d.decidedAt)||Date.parse(d.decidedAt)<Date.parse(dispute.requestedAt!)||d.proposalDigest!==digestVariablePaymentSources(proposal)||typeof d.evidenceDigest!=='string'||!/^[a-f0-9]{64}$/.test(d.evidenceDigest))return fail();
  resolved=buildHourlyExcessAdministrativeResolution(record,d);
 }
 if(resolved?(!resolution.exists||canonicalVariablePaymentRecord(resolution.data())!==canonicalVariablePaymentRecord(resolved)):resolution.exists)return fail();
 const obligation=resolved?buildHourlyExcessObligation(record,resolved):null;
 if(obligation?(!final.exists||canonicalVariablePaymentRecord(final.data())!==canonicalVariablePaymentRecord(obligation)):final.exists||history.exists)return fail();
 const restricted=!!dispute&&['open','review_requested'].includes(dispute.status);
 const queueRef=adminDb.doc('freelanceHourlyExcessReviewsV1/'+id),queue=(await tx.get(queueRef)).data();
 if(dispute?.requestedAt){
  if(!queue||Object.keys(queue).length!==6||queue.offerId!==id||queue.requesterUid!==record.commitment.requesterUid||queue.beneficiaryUid!==record.commitment.beneficiaryUid||queue.sourceDigest!==record.sourceDigest||queue.requestedAt!==dispute.requestedAt||queue.status!==(restricted?'pending':dispute.status))return fail();
 }else if(queue)return fail();
 const evidence=await readHourlyReviewNotes(tx,queueRef,record.commitment,record.sourceDigest,dispute?.requestedAt);
 if(dispute?.decision&&dispute.decision.evidenceDigest!==evidence.digest)return fail();
 await prepareExcessRestriction(tx,record.commitment,restricted,restricted);
 return {s,record,c,direct,pointer,proposal,resolutionRef,resolved,dispute,disputeRef,restricted,queueRef,obligation,finalRef:final.ref,statementRef:history.ref,history,evidence};
}
export type HourlyExcessAdminDecision={actorUid:string;recognizedExcessMs:number;reason:string;decidedAt:string;proposalDigest:string;evidenceDigest:string};
export function buildHourlyExcessAdministrativeResolution(record:Awaited<ReturnType<typeof readVariablePaymentSources>>['record'],d:HourlyExcessAdminDecision){
 return {schemaVersion:1,kind:'hourly_excess_resolution',offerId:record.commitment.offerId,baseDigest:record.sourceDigest,sourceDigest:digestVariablePaymentSources({base:record.sourceDigest,decision:d}),resolvedAt:d.decidedAt,...calculateHourlyExcessResolution(record,d.recognizedExcessMs),payable:false};
}
function buildResolution(record:Awaited<ReturnType<typeof readVariablePaymentSources>>['record'],p:Proposal){
 return {schemaVersion:1,kind:'hourly_excess_resolution',offerId:record.commitment.offerId,baseDigest:record.sourceDigest,sourceDigest:digestVariablePaymentSources({base:record.sourceDigest,proposal:p}),resolvedAt:p.decidedAt!,...calculateHourlyExcessResolution(record,p.recognizedExcessMs),payable:false};
}
export function buildHourlyExcessObligation(record:Awaited<ReturnType<typeof readVariablePaymentSources>>['record'],resolved:ReturnType<typeof buildResolution>){
 const c=record.commitment,amount=resolved.recognizedServiceMinor;
 if(!Number.isSafeInteger(amount)||amount<0||resolved.baseDigest!==record.sourceDigest||resolved.offerId!==c.offerId||!iso(resolved.resolvedAt)||Date.parse(resolved.resolvedAt)<Date.parse(record.completedAt))return fail();
 if(amount===0)return null;
 return {schemaVersion:1 as const,kind:'hourly_excess_obligation' as const,offerId:c.offerId,requesterUid:c.requesterUid,beneficiaryUid:c.beneficiaryUid,...(c.requesterStoreId?{requesterStoreId:c.requesterStoreId}:{}),contractedAt:c.contractedAt,dueAt:resolved.resolvedAt,sourceDigest:resolved.sourceDigest,amountMinor:amount,currency:'BRL' as const,method:'external_pix' as const,custody:'none' as const};
}
export async function readHourlyExcessReview(uid:string,id:string){
 return adminDb.runTransaction(async tx=>{
  const {record,c,proposal,resolved,dispute,restricted,obligation}=await readHourlyExcessContext(tx,uid,id),a=record.accounting;
  return {offerId:id,role:c.actor,sourceDigest:record.sourceDigest,estimatedMinor:record.commitment.estimatedMinor,hourlyRateMinor:a.hourlyRateMinor,authorizedMinor:a.withinCapReferenceMinor,excessMs:a.excessMs,recordedMs:a.compensableMs,proposal,resolved,dispute:dispute?{status:dispute.status,openedAt:dispute.openedAt,requestedAt:dispute.requestedAt??null,...(dispute.decision?{decision:{recognizedExcessMs:dispute.decision.recognizedExcessMs,reason:dispute.decision.reason,decidedAt:dispute.decision.decidedAt}}:{})}:null,restrictionActive:restricted,payable:!!obligation,bankVerified:false};
 },{readOnly:true});
}
export async function changeHourlyExcessReview(uid:string,id:string,action:'propose'|'accept'|'decline'|'withdraw',input:{proposalId:unknown;sourceDigest:unknown;recognizedExcessMs?:unknown;confirmed:unknown}){
 if(!validFreelanceId(input.proposalId)||input.confirmed!==true||typeof input.sourceDigest!=='string'||!/^[a-f0-9]{64}$/.test(input.sourceDigest))throw Error('FREELANCE_INVALID');
 const proposalId=input.proposalId;
 return adminDb.runTransaction(async tx=>{
  const {record,c,direct,pointer,proposal:p,resolutionRef,dispute,disputeRef,restricted,queueRef,finalRef}=await readHourlyExcessContext(tx,uid,id);
  if(input.sourceDigest!==record.sourceDigest||dispute?.status==='resolved_administratively')return fail();
  const now=new Date().toISOString(),ref=direct.doc('hourlyExcessAgreement-'+proposalId),recipient=c.actor==='worker'?'requester':'freelancer';
  if(Date.parse(now)<Date.parse(record.completedAt))return fail();
  if(action==='propose'){
   const ms=input.recognizedExcessMs;
   if(typeof ms!=='number'||!Number.isSafeInteger(ms)||ms<0||ms>record.accounting.excessMs)throw Error('FREELANCE_INVALID');
   calculateHourlyExcessResolution(record,ms);
   if(p?.id===proposalId){if(p.proposedBy!==c.actor||p.recognizedExcessMs!==ms)return fail();return {changed:false};}
   if((p&&['pending','accepted'].includes(p.status))||(await tx.get(ref)).exists)return fail();
   const next:Proposal={schemaVersion:1,id:proposalId,sourceDigest:record.sourceDigest,recognizedExcessMs:ms,proposedBy:c.actor,proposedAt:now,status:'pending'};
   tx.create(ref,next);tx.set(pointer,{schemaVersion:1,proposalId});
   writeFreelanceFinancialNotices(tx,record.commitment,'hourly_excess_proposed',now,recipient,proposalId);
   return {changed:true};
  }
  if(!p||p.id!==proposalId)return fail();
  const status=action==='accept'?'accepted':action==='decline'?'declined':'withdrawn';
  if(action==='withdraw'?p.proposedBy!==c.actor:p.proposedBy===c.actor)throw Error('FREELANCE_FORBIDDEN');
  if(p.status===status&&p.decidedBy===c.actor)return {changed:false};
  if(p.status!=='pending'||Date.parse(now)<Date.parse(p.proposedAt))return fail();
  const release=status==='accepted'&&restricted?await prepareExcessRestriction(tx,record.commitment,true,false):()=>{};
  if(status==='accepted'){
   if(restricted){if(!dispute||Date.parse(now)<Date.parse(dispute.requestedAt??dispute.openedAt))return fail();tx.update(disputeRef,{status:'resolved_voluntarily',resolvedAt:now,agreementId:p.id});if(dispute.requestedAt)tx.update(queueRef,{status:'resolved_voluntarily'});release();}
   const resolution=buildResolution(record,{...p,status,decidedBy:c.actor,decidedAt:now});
   const final=buildHourlyExcessObligation(record,resolution);
   tx.create(resolutionRef,resolution);if(final)tx.create(finalRef,final);
  }
  tx.update(ref,{status,decidedBy:c.actor,decidedAt:now});
  writeFreelanceFinancialNotices(tx,record.commitment,status==='accepted'?'hourly_excess_accepted':'hourly_excess_closed',now,recipient,proposalId);
  return {changed:true};
 });
}

export async function changeHourlyExcessDispute(uid:string,id:string,action:'open'|'request_review',input:{sourceDigest:unknown;confirmed:unknown}){
 if(input.confirmed!==true||typeof input.sourceDigest!=='string'||!/^[a-f0-9]{64}$/.test(input.sourceDigest))throw Error('FREELANCE_INVALID');
 return adminDb.runTransaction(async tx=>{
  const {record,c,proposal,dispute,disputeRef,restricted,queueRef}=await readHourlyExcessContext(tx,uid,id);
  if(input.sourceDigest!==record.sourceDigest)return fail();
  const now=new Date().toISOString();
  if(action==='open'){
   if(dispute){if(restricted&&dispute.openedBy===c.actor)return {changed:false};return fail();}
   if(proposal?.status!=='declined'||!proposal.decidedAt||Date.parse(now)<Date.parse(proposal.decidedAt))return fail();
   const write=await prepareExcessRestriction(tx,record.commitment,false,true);
   tx.create(disputeRef,{schemaVersion:1,sourceDigest:record.sourceDigest,openedBy:c.actor,openedAt:now,status:'open'});
   write();writeFreelanceFinancialNotices(tx,record.commitment,'hourly_excess_disputed',now,'both','dispute');return {changed:true};
  }
  if(!dispute||!restricted)return fail();
  if(dispute.status==='review_requested'){if(dispute.requestedBy===c.actor)return {changed:false};return fail();}
  if(dispute.status!=='open'||Date.parse(now)<Date.parse(dispute.openedAt))return fail();
  tx.update(disputeRef,{status:'review_requested',requestedAt:now,requestedBy:c.actor});
  tx.create(queueRef,{offerId:id,requesterUid:record.commitment.requesterUid,beneficiaryUid:record.commitment.beneficiaryUid,sourceDigest:record.sourceDigest,requestedAt:now,status:'pending'});
  writeFreelanceFinancialNotices(tx,record.commitment,'hourly_excess_review_requested',now,'both','dispute');return {changed:true};
 });
}
