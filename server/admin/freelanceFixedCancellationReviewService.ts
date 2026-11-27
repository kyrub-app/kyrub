import {buildFixedCancellationResolution,writeFixedResolution} from '../freelance/freelanceFixedCancellationResolution.js';
import {digestVariablePaymentSources} from '../freelance/freelanceVariablePaymentBasisService.js';
import {projectHourlyReviewNotes,projectHourlyAttachments,readHourlyAttachment} from '../freelance/freelanceHourlyReviewNotes.js';
import {calculateCancellationAccounting} from '../../shared/freelanceCancellationAccounting.js';
import {createHash} from 'node:crypto';
import {FieldPath,FieldValue} from 'firebase-admin/firestore';
import {adminDb} from '../firebaseAdmin.js';
import {requireKyrubSessionMfa} from '../identity/kyrubMfaAuthorization.js';
import {validFreelanceId} from '../../shared/freelanceLifecycle.js';
import {financialReviewAdminEnabled} from './freelanceFinancialReviewService.js';
import {readFixedCancellationContext} from '../freelance/freelanceCancellationAccountingService.js';
import {prepareCancellationRestriction} from '../freelance/freelanceEngagementRestrictionService.js';
import {writeFreelanceFinancialNotices} from '../freelance/freelanceFinancialNoticeService.js';
const fail=():never=>{throw Error('FREELANCE_FINANCIAL_REVIEW_CONFLICT');};
async function actor(auth:string){
 if(!financialReviewAdminEnabled())throw Error('FREELANCE_FINANCIAL_REVIEW_DISABLED');
 const identity=await requireKyrubSessionMfa(auth,'administrative',300);
 if(identity.email_verified!==true||!validFreelanceId(identity.uid))throw Error('FORBIDDEN');
 return identity.uid;
}
async function role(tx:FirebaseFirestore.Transaction,uid:string){
 const r=(await tx.get(adminDb.doc('kyrub_admin/control_plane/admins/'+uid))).data();
 if(!r||r.uid!==uid||r.role!=='super_admin'||r.status!=='active')throw Error('FORBIDDEN');
}
export async function listFixedCancellationReviews(auth:string,cursor:unknown){
 if(cursor!==undefined&&cursor!==''&&!validFreelanceId(cursor))throw Error('FREELANCE_INVALID');
 const uid=await actor(auth);
 return adminDb.runTransaction(async tx=>{
  await role(tx,uid);
  let q=adminDb.collection('freelanceFixedCancellationReviewsV1').where('status','==','pending').orderBy(FieldPath.documentId()).limit(21);
  if(typeof cursor==='string'&&cursor)q=q.startAfter(cursor);
  const page=await tx.get(q),docs=page.docs.slice(0,20),items=[];
  for(const doc of docs){
   const r=doc.data();
   if(r.offerId!==doc.id||!validFreelanceId(r.requesterUid)||!validFreelanceId(r.beneficiaryUid))return fail();
   if([r.requesterUid,r.beneficiaryUid].includes(uid))continue;
   const c=await readFixedCancellationContext(tx,r.requesterUid,doc.id);
   if(!c.cancellationRestricted||c.dispute?.status!=='review_requested')return fail();
   items.push({offerId:doc.id,title:c.offer.title,sourceDigest:c.snapshot,requestedAt:c.dispute.requestedAt,capMinor:c.obligation.terms.amountMinor,priorPaymentState:c.projection.state,eligible:c.eligible,proposal:c.proposal?{id:c.proposal.id,status:c.stale?'stale':c.proposal.status,recognizedServiceMinor:c.proposal.recognizedServiceMinor,reportedReceivedMinor:c.proposal.reportedReceivedMinor}:null,proposalDigest:digestVariablePaymentSources(c.proposal??null),evidenceDigest:c.evidence.digest,notes:projectHourlyReviewNotes(c.evidence.notes,c.obligation),attachments:projectHourlyAttachments(c.evidence.attachments,c.obligation),bankVerified:false});
  }
  return {items,nextCursor:page.size>20?docs.at(-1)!.id:null};
 },{readOnly:true});
}
export async function decideFixedCancellationReview(auth:string,input:unknown){
 if(!input||typeof input!=='object'||Array.isArray(input))throw Error('FREELANCE_INVALID');
 const b=input as Record<string,unknown>;
 if(Object.keys(b).length!==9||Object.keys(b).some(k=>!['offerId','sourceDigest','expectedRequestedAt','proposalDigest','evidenceDigest','recognizedServiceMinor','reportedReceivedMinor','reason','confirmed'].includes(k))||!validFreelanceId(b.offerId)||typeof b.sourceDigest!=='string'||!/^[a-f0-9]{64}$/.test(b.sourceDigest)||typeof b.expectedRequestedAt!=='string'||typeof b.evidenceDigest!=='string'||!/^[a-f0-9]{64}$/.test(b.evidenceDigest)||typeof b.recognizedServiceMinor!=='number'||!Number.isSafeInteger(b.recognizedServiceMinor)||b.recognizedServiceMinor<0||typeof b.reportedReceivedMinor!=='number'||!Number.isSafeInteger(b.reportedReceivedMinor)||b.reportedReceivedMinor<0||typeof b.reason!=='string'||b.reason.trim().length<10||b.reason.trim().length>1000||b.confirmed!==true)throw Error('FREELANCE_INVALID');
 const id=b.offerId,amount=b.recognizedServiceMinor,received=b.reportedReceivedMinor,reason=b.reason.trim(),uid=await actor(auth);
 const auditId='freelance_fixed_cancellation_'+createHash('sha256').update(id).digest('hex');
 return adminDb.runTransaction(async tx=>{
  await role(tx,uid);
  const queue=(await tx.get(adminDb.doc('freelanceFixedCancellationReviewsV1/'+id))).data();
  if(!queue||!validFreelanceId(queue.requesterUid)||!validFreelanceId(queue.beneficiaryUid))return fail();
  if([queue.requesterUid,queue.beneficiaryUid].includes(uid))throw Error('FORBIDDEN');
  const c=await readFixedCancellationContext(tx,queue.requesterUid,id);
  if(!c.dispute||c.snapshot!==b.sourceDigest||c.dispute.requestedAt!==b.expectedRequestedAt||!c.eligible||amount>c.obligation.terms.amountMinor||received>c.obligation.terms.amountMinor||b.proposalDigest!==digestVariablePaymentSources(c.proposal??null)||b.evidenceDigest!==c.evidence.digest)return fail();
  const auditRef=adminDb.doc('kyrub_admin/control_plane/audit_logs/'+auditId),audit=await tx.get(auditRef),reasonHash=createHash('sha256').update(reason).digest('hex');
  if(c.dispute.status==='resolved_administratively'){
   const d=c.dispute.decision!;
   if(d.actorUid!==uid||d.reason!==reason||d.recognizedServiceMinor!==amount||d.reportedReceivedMinor!==received||!audit.exists||audit.get('actorId')!==uid||audit.get('targetId')!==id||audit.get('sourceDigest')!==b.sourceDigest||audit.get('reasonHash')!==reasonHash||audit.get('recognizedServiceMinor')!==amount||audit.get('reportedReceivedMinor')!==received||audit.get('proposalDigest')!==b.proposalDigest||audit.get('evidenceDigest')!==b.evidenceDigest)return fail();
   return {status:c.dispute.status,replay:true,bankVerified:false};
  }
  if(c.dispute.status!=='review_requested'||!c.cancellationRestricted||audit.exists)return fail();
  for(const a of c.evidence.attachments)await readHourlyAttachment(tx,c.evidence,a.id);
  const release=await prepareCancellationRestriction(tx,c.obligation,true,false),now=new Date().toISOString();
  if(Date.parse(now)<Date.parse(c.dispute.requestedAt!))return fail();
  calculateCancellationAccounting(c.obligation,c.events,amount,received);
  const decision={actorUid:uid,recognizedServiceMinor:amount,reportedReceivedMinor:received,snapshot:c.snapshot,reason,decidedAt:now,proposalDigest:digestVariablePaymentSources(c.proposal??null),evidenceDigest:c.evidence.digest};
  const resolution=buildFixedCancellationResolution({...c.resolutionBase,kind:'administrative',resolvedAt:now,recognizedServiceMinor:amount,reportedReceivedMinor:received,decision});
  writeFixedResolution(tx,c.resolutionRecords,resolution);
  tx.update(c.disputeRef,{status:'resolved_administratively',decision});
  tx.update(c.queueRef,{status:'resolved_administratively'});
  tx.create(auditRef,{id:auditId,action:'admin.freelance.fixed_cancellation_resolved',actorId:uid,actorRole:'super_admin',targetType:'freelance_fixed_cancellation_review',targetId:id,sourceDigest:b.sourceDigest,recognizedServiceMinor:amount,reportedReceivedMinor:received,proposalDigest:decision.proposalDigest,evidenceDigest:decision.evidenceDigest,reasonHash,bankVerified:false,source:'server',createdAt:FieldValue.serverTimestamp()});
  release();writeFreelanceFinancialNotices(tx,c.obligation,'fixed_cancellation_admin_resolved',now,'both','dispute');
  return {status:'resolved_administratively',replay:false,bankVerified:false};
 });
}

export async function getFixedCancellationAttachment(auth:string,id:unknown,attachmentId:unknown){
 if(!validFreelanceId(id)||!validFreelanceId(attachmentId))throw Error('FREELANCE_INVALID');
 const uid=await actor(auth);
 return adminDb.runTransaction(async tx=>{
  await role(tx,uid);
  const q=(await tx.get(adminDb.doc('freelanceFixedCancellationReviewsV1/'+id))).data();
  if(!q||!validFreelanceId(q.requesterUid)||!validFreelanceId(q.beneficiaryUid)||[q.requesterUid,q.beneficiaryUid].includes(uid))throw Error('FORBIDDEN');
  const c=await readFixedCancellationContext(tx,q.requesterUid,id);
  if(!c.dispute?.requestedAt||c.dispute.status!=='review_requested')return fail();
  return readHourlyAttachment(tx,c.evidence,attachmentId);
 },{readOnly:true});
}
