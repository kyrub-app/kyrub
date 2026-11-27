import {prepareCancellationRestriction} from './freelanceEngagementRestrictionService.js';
import type {Transaction} from 'firebase-admin/firestore';
import {adminDb} from '../firebaseAdmin.js';
import {validFreelanceId} from '../../shared/freelanceLifecycle.js';
import {readHourlyCancellationContext} from './freelanceHourlyCancellationService.js';
import {writeFreelanceFinancialNotices} from './freelanceFinancialNoticeService.js';

const fail=():never=>{throw Error('FREELANCE_VARIABLE_PAYMENT_CONFLICT');};
const iso=(v:unknown):v is string=>typeof v==='string'&&Number.isFinite(Date.parse(v))&&new Date(Date.parse(v)).toISOString()===v;
type Role='worker'|'requester';
type Proposal={schemaVersion:1;id:string;sourceDigest:string;recognizedServiceMinor:number;proposedBy:Role;proposedAt:string;status:'pending'|'accepted'|'declined'|'withdrawn';decidedBy?:Role;decidedAt?:string};
export async function readHourlyCancellationAgreementContext(tx:Transaction,uid:string,id:string){
 const {c,record}=await readHourlyCancellationContext(tx,uid,id);
 // The authorized cap is a ceiling for this voluntary service-only agreement,
 // not an assessment of damages, travel reimbursement or liability.
 const capMinor=record.accounting?.authorizedCapMinor??record.commitment.estimatedMinor;
 const direct=c.ref.collection('directPayment'),pointer=direct.doc('hourlyCancellationAgreement');
 const raw=(await tx.get(pointer)).data();
 let proposal:Proposal|null=null;
 if(raw){
  if(Object.keys(raw).length!==2||raw.schemaVersion!==1||!validFreelanceId(raw.proposalId))return fail();
  proposal=((await tx.get(direct.doc('hourlyCancellationAgreement-'+raw.proposalId))).data() as Proposal|undefined)??null;
  if(!proposal||proposal.schemaVersion!==1||proposal.id!==raw.proposalId||proposal.sourceDigest!==record.sourceDigest||
   !Number.isSafeInteger(proposal.recognizedServiceMinor)||proposal.recognizedServiceMinor<0||proposal.recognizedServiceMinor>capMinor||
   !['worker','requester'].includes(proposal.proposedBy)||!iso(proposal.proposedAt)||Date.parse(proposal.proposedAt)<Date.parse(record.cancelledAt)||
   !['pending','accepted','declined','withdrawn'].includes(proposal.status)||Object.keys(proposal).length!==(proposal.status==='pending'?7:9))return fail();
  if(proposal.status==='pending'){if(proposal.decidedBy!==undefined||proposal.decidedAt!==undefined)return fail();}
  else if(!iso(proposal.decidedAt)||Date.parse(proposal.decidedAt)<Date.parse(proposal.proposedAt)||!['worker','requester'].includes(proposal.decidedBy??'')||
   (proposal.status==='withdrawn'?proposal.decidedBy!==proposal.proposedBy:proposal.decidedBy===proposal.proposedBy))return fail();
 }
 const disputeRef=direct.doc('hourlyCancellationDispute'),rawDispute=(await tx.get(disputeRef)).data();
 const dispute=rawDispute as {schemaVersion:1;sourceDigest:string;openedBy:Role;openedAt:string;status:'open'|'review_requested'|'resolved_voluntarily'|'resolved_administratively';decision?:{actorUid:string;recognizedServiceMinor:number;reason:string;decidedAt:string};requestedBy?:Role;requestedAt?:string;resolvedAt?:string;agreementId?:string}|undefined;
 if(dispute){
  const requested=dispute.requestedAt!==undefined||dispute.requestedBy!==undefined;
  if(dispute.schemaVersion!==1||dispute.sourceDigest!==record.sourceDigest||!['worker','requester'].includes(dispute.openedBy)||!iso(dispute.openedAt)||Date.parse(dispute.openedAt)<Date.parse(record.cancelledAt)||
   !['open','review_requested','resolved_voluntarily','resolved_administratively'].includes(dispute.status)||Object.keys(dispute).length!==5+(requested?2:0)+(dispute.status==='resolved_voluntarily'?2:dispute.status==='resolved_administratively'?1:0)||
   (requested&&(!iso(dispute.requestedAt)||Date.parse(dispute.requestedAt)<Date.parse(dispute.openedAt)||!['worker','requester'].includes(dispute.requestedBy??'')))||
   (dispute.status==='open'&&requested)||(['review_requested','resolved_administratively'].includes(dispute.status)&&!requested)||
   (dispute.status==='resolved_voluntarily'?(!iso(dispute.resolvedAt)||Date.parse(dispute.resolvedAt)<Date.parse(dispute.requestedAt??dispute.openedAt)||proposal?.status!=='accepted'||dispute.agreementId!==proposal.id||dispute.resolvedAt!==proposal.decidedAt):proposal?.status==='accepted'))return fail();
 }
 if(dispute?.status==='resolved_administratively'){
  const d=dispute.decision;
  if(!d||Object.keys(d).length!==4||!validFreelanceId(d.actorUid)||[record.commitment.requesterUid,record.commitment.beneficiaryUid].includes(d.actorUid)||!Number.isSafeInteger(d.recognizedServiceMinor)||d.recognizedServiceMinor<0||d.recognizedServiceMinor>capMinor||typeof d.reason!=='string'||d.reason.trim()!==d.reason||d.reason.length<10||d.reason.length>1000||!iso(d.decidedAt)||Date.parse(d.decidedAt)<Date.parse(dispute.requestedAt!))return fail();
 }
 const restricted=!!dispute&&['open','review_requested'].includes(dispute.status);
 const queueRef=adminDb.doc('freelanceHourlyCancellationReviewsV1/'+id),queue=(await tx.get(queueRef)).data();
 if(dispute?.requestedAt){
  if(!queue||Object.keys(queue).length!==6||queue.offerId!==id||queue.requesterUid!==record.commitment.requesterUid||queue.beneficiaryUid!==record.commitment.beneficiaryUid||queue.sourceDigest!==record.sourceDigest||queue.requestedAt!==dispute.requestedAt||queue.status!==(dispute.status==='review_requested'?'pending':dispute.status))return fail();
 }else if(queue)return fail();
 await prepareCancellationRestriction(tx,record.commitment,restricted,restricted);
 return {c,record,capMinor,direct,pointer,proposal,dispute,disputeRef,restricted,queueRef};
}
export async function readHourlyCancellationAgreement(uid:string,id:string){
 return adminDb.runTransaction(async tx=>{
  const {c,record,capMinor,proposal,dispute,restricted}=await readHourlyCancellationAgreementContext(tx,uid,id);
  return {offerId:id,role:c.actor,sourceDigest:record.sourceDigest,estimatedMinor:record.commitment.estimatedMinor,capMinor,
   referenceMinor:record.accounting?.withinCapReferenceMinor??null,recordedMs:record.accounting?.compensableMs??null,
   excessMs:record.accounting?.excessMs??null,proposal,agreedMinor:proposal?.status==='accepted'?proposal.recognizedServiceMinor:null,administrativeMinor:dispute?.decision?.recognizedServiceMinor??null,
   dispute:dispute?{status:dispute.status,openedAt:dispute.openedAt,requestedAt:dispute.requestedAt??null,...(dispute.decision?{decision:{recognizedServiceMinor:dispute.decision.recognizedServiceMinor,reason:dispute.decision.reason,decidedAt:dispute.decision.decidedAt}}:{})}:null,restrictionActive:restricted,payable:false,bankVerified:false};
 },{readOnly:true});
}
export async function changeHourlyCancellationAgreement(uid:string,id:string,action:'propose'|'accept'|'decline'|'withdraw',input:{proposalId:unknown;sourceDigest:unknown;recognizedServiceMinor?:unknown;confirmed:unknown}){
 if(!validFreelanceId(input.proposalId)||input.confirmed!==true||typeof input.sourceDigest!=='string'||!/^[a-f0-9]{64}$/.test(input.sourceDigest))throw Error('FREELANCE_INVALID');
 const proposalId=input.proposalId;
 return adminDb.runTransaction(async tx=>{
  const {c,record,capMinor,direct,pointer,proposal:p,dispute,disputeRef,restricted,queueRef}=await readHourlyCancellationAgreementContext(tx,uid,id);
  if(input.sourceDigest!==record.sourceDigest)return fail();
  if(dispute?.status==='resolved_administratively')return fail();
  const now=new Date().toISOString(),ref=direct.doc('hourlyCancellationAgreement-'+proposalId);
  if(Date.parse(now)<Date.parse(record.cancelledAt))return fail();
  const recipient=c.actor==='requester'?'freelancer':'requester';
  if(action==='propose'){
   const amount=input.recognizedServiceMinor;
   if(typeof amount!=='number'||!Number.isSafeInteger(amount)||amount<0||amount>capMinor)throw Error('FREELANCE_INVALID');
   if(p?.id===proposalId){if(p.proposedBy!==c.actor||p.recognizedServiceMinor!==amount)return fail();return {changed:false};}
   if((p&&['pending','accepted'].includes(p.status))||(await tx.get(ref)).exists)return fail();
   const next:Proposal={schemaVersion:1,id:proposalId,sourceDigest:record.sourceDigest,recognizedServiceMinor:amount,proposedBy:c.actor,proposedAt:now,status:'pending'};
   tx.create(ref,next);tx.set(pointer,{schemaVersion:1,proposalId});
   writeFreelanceFinancialNotices(tx,record.commitment,'hourly_cancellation_proposed',now,recipient,proposalId);
   return {changed:true};
  }
  if(!p||p.id!==proposalId)return fail();
  const status=action==='accept'?'accepted':action==='decline'?'declined':'withdrawn';
  if(action==='withdraw'?c.actor!==p.proposedBy:c.actor===p.proposedBy)throw Error('FREELANCE_FORBIDDEN');
  if(p.status===status&&p.decidedBy===c.actor)return {changed:false};
  if(p.status!=='pending'||Date.parse(now)<Date.parse(p.proposedAt))return fail();
  const release=status==='accepted'&&restricted?await prepareCancellationRestriction(tx,record.commitment,true,false):()=>{};
  if(status==='accepted'&&restricted){if(!dispute||Date.parse(now)<Date.parse(dispute.requestedAt??dispute.openedAt))return fail();tx.update(disputeRef,{status:'resolved_voluntarily',resolvedAt:now,agreementId:p.id});if(dispute.requestedAt)tx.update(queueRef,{status:'resolved_voluntarily'});release();}
  tx.update(ref,{status,decidedBy:c.actor,decidedAt:now});
  writeFreelanceFinancialNotices(tx,record.commitment,status==='accepted'?'hourly_cancellation_accepted':'hourly_cancellation_closed',now,recipient,proposalId);
  return {changed:true};
 });
}

/** Declining is not itself a dispute. Explicit opening after a declined
 * proposal; agreement remains available while restricted or awaiting review. */
export async function changeHourlyCancellationDispute(uid:string,id:string,action:'open'|'request_review',input:{sourceDigest:unknown;confirmed:unknown}){
 if(input.confirmed!==true||typeof input.sourceDigest!=='string'||!/^[a-f0-9]{64}$/.test(input.sourceDigest))throw Error('FREELANCE_INVALID');
 return adminDb.runTransaction(async tx=>{
  const {c,record,proposal,dispute,disputeRef,restricted,queueRef}=await readHourlyCancellationAgreementContext(tx,uid,id);
  if(input.sourceDigest!==record.sourceDigest)return fail();
  const now=new Date().toISOString();
  if(action==='open'){
   if(dispute){if(restricted&&dispute.openedBy===c.actor)return {changed:false};return fail();}
   if(proposal?.status!=='declined'||!proposal.decidedAt||Date.parse(now)<Date.parse(proposal.decidedAt))return fail();
   const write=await prepareCancellationRestriction(tx,record.commitment,false,true);
   tx.create(disputeRef,{schemaVersion:1,sourceDigest:record.sourceDigest,openedBy:c.actor,openedAt:now,status:'open'});
   write();writeFreelanceFinancialNotices(tx,record.commitment,'hourly_cancellation_disputed',now,'both','dispute');
   return {changed:true};
  }
  if(!dispute||!restricted)return fail();
  if(dispute.status==='review_requested'){if(dispute.requestedBy===c.actor)return {changed:false};return fail();}
  if(dispute.status!=='open'||Date.parse(now)<Date.parse(dispute.openedAt))return fail();
  tx.update(disputeRef,{status:'review_requested',requestedBy:c.actor,requestedAt:now});
  tx.create(queueRef,{offerId:id,requesterUid:record.commitment.requesterUid,beneficiaryUid:record.commitment.beneficiaryUid,sourceDigest:record.sourceDigest,requestedAt:now,status:'pending'});
  writeFreelanceFinancialNotices(tx,record.commitment,'hourly_cancellation_review_requested',now,'both','dispute');
  return {changed:true};
 });
}
