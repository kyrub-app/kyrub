import {digestVariablePaymentSources} from '../freelance/freelanceVariablePaymentBasisService.js';
import {projectHourlyReviewNotes,projectHourlyAttachments,readHourlyAttachment} from '../freelance/freelanceHourlyReviewNotes.js';
import {buildHourlyCancellationResolution,writeCancellationResolution} from '../freelance/freelanceHourlyCancellationResolution.js';
import {createHash} from 'node:crypto';
import {FieldPath,FieldValue} from 'firebase-admin/firestore';
import {adminDb} from '../firebaseAdmin.js';
import {requireKyrubSessionMfa} from '../identity/kyrubMfaAuthorization.js';
import {validFreelanceId} from '../../shared/freelanceLifecycle.js';
import {financialReviewAdminEnabled} from './freelanceFinancialReviewService.js';
import {readHourlyCancellationAgreementContext} from '../freelance/freelanceHourlyCancellationAgreementService.js';
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
export async function listHourlyCancellationReviews(auth:string,cursor:unknown){
 if(cursor!==undefined&&cursor!==''&&!validFreelanceId(cursor))throw Error('FREELANCE_INVALID');
 const uid=await actor(auth);
 return adminDb.runTransaction(async tx=>{
  await role(tx,uid);
  let q=adminDb.collection('freelanceHourlyCancellationReviewsV1').where('status','==','pending').orderBy(FieldPath.documentId()).limit(21);
  if(typeof cursor==='string'&&cursor)q=q.startAfter(cursor);
  const page=await tx.get(q),docs=page.docs.slice(0,20),items=[];
  for(const doc of docs){
   const r=doc.data();
   if(r.offerId!==doc.id||!validFreelanceId(r.requesterUid)||!validFreelanceId(r.beneficiaryUid))return fail();
   if([r.requesterUid,r.beneficiaryUid].includes(uid))continue;
   const c=await readHourlyCancellationAgreementContext(tx,r.requesterUid,doc.id);
   if(!c.restricted||c.dispute?.status!=='review_requested')return fail();
   items.push({offerId:doc.id,title:c.c.offer.title,sourceDigest:c.record.sourceDigest,requestedAt:c.dispute.requestedAt,capMinor:c.capMinor,referenceMinor:c.record.accounting?.withinCapReferenceMinor??null,recordedMs:c.record.accounting?.compensableMs??null,excessMs:c.record.accounting?.excessMs??null,proposal:c.proposal,proposalDigest:digestVariablePaymentSources(c.proposal),evidenceDigest:c.evidence.digest,notes:projectHourlyReviewNotes(c.evidence.notes,c.record.commitment),attachments:projectHourlyAttachments(c.evidence.attachments,c.record.commitment),bankVerified:false});
  }
  return {items,nextCursor:page.size>20?docs.at(-1)!.id:null};
 },{readOnly:true});
}
export async function decideHourlyCancellationReview(auth:string,input:unknown){
 if(!input||typeof input!=='object'||Array.isArray(input))throw Error('FREELANCE_INVALID');
 const b=input as Record<string,unknown>;
 if(Object.keys(b).length!==8||Object.keys(b).some(k=>!['offerId','sourceDigest','expectedRequestedAt','proposalDigest','evidenceDigest','recognizedServiceMinor','reason','confirmed'].includes(k))||!validFreelanceId(b.offerId)||typeof b.sourceDigest!=='string'||!/^[a-f0-9]{64}$/.test(b.sourceDigest)||typeof b.expectedRequestedAt!=='string'||typeof b.evidenceDigest!=='string'||!/^[a-f0-9]{64}$/.test(b.evidenceDigest)||typeof b.recognizedServiceMinor!=='number'||!Number.isSafeInteger(b.recognizedServiceMinor)||b.recognizedServiceMinor<0||typeof b.reason!=='string'||b.reason.trim().length<10||b.reason.trim().length>1000||b.confirmed!==true)throw Error('FREELANCE_INVALID');
 const id=b.offerId,amount=b.recognizedServiceMinor,reason=b.reason.trim(),uid=await actor(auth);
 const auditId='freelance_hourly_cancellation_'+createHash('sha256').update(id).digest('hex');
 return adminDb.runTransaction(async tx=>{
  await role(tx,uid);
  const queue=(await tx.get(adminDb.doc('freelanceHourlyCancellationReviewsV1/'+id))).data();
  if(!queue||!validFreelanceId(queue.requesterUid)||!validFreelanceId(queue.beneficiaryUid))return fail();
  if([queue.requesterUid,queue.beneficiaryUid].includes(uid))throw Error('FORBIDDEN');
  const c=await readHourlyCancellationAgreementContext(tx,queue.requesterUid,id);
  if(!c.dispute||c.record.sourceDigest!==b.sourceDigest||c.dispute.requestedAt!==b.expectedRequestedAt||amount>c.capMinor||b.proposalDigest!==digestVariablePaymentSources(c.proposal)||b.evidenceDigest!==c.evidence.digest)return fail();
  const auditRef=adminDb.doc('kyrub_admin/control_plane/audit_logs/'+auditId),audit=await tx.get(auditRef),reasonHash=createHash('sha256').update(reason).digest('hex');
  if(c.dispute.status==='resolved_administratively'){
   const d=c.dispute.decision!;
   if(d.actorUid!==uid||d.reason!==reason||d.recognizedServiceMinor!==amount||!audit.exists||audit.get('actorId')!==uid||audit.get('targetId')!==id||audit.get('sourceDigest')!==b.sourceDigest||audit.get('reasonHash')!==reasonHash||audit.get('recognizedServiceMinor')!==amount||audit.get('proposalDigest')!==b.proposalDigest||audit.get('evidenceDigest')!==b.evidenceDigest)return fail();
   return {status:c.dispute.status,replay:true,bankVerified:false};
  }
  if(c.dispute.status!=='review_requested'||!c.restricted||audit.exists)return fail();
  for(const a of c.evidence.attachments)await readHourlyAttachment(tx,c.evidence,a.id);
  const release=await prepareCancellationRestriction(tx,c.record.commitment,true,false),now=new Date().toISOString();
  if(Date.parse(now)<Date.parse(c.dispute.requestedAt!))return fail();
  const decision={actorUid:uid,recognizedServiceMinor:amount,reason,decidedAt:now,proposalDigest:digestVariablePaymentSources(c.proposal),evidenceDigest:c.evidence.digest};
  const resolution=buildHourlyCancellationResolution({sourceDigest:c.record.sourceDigest,commitment:c.record.commitment,capMinor:c.capMinor,recognizedServiceMinor:amount,resolvedAt:now,resolution:'administrative',evidence:decision});
  writeCancellationResolution(tx,c.resolutionRecords,resolution);
  tx.update(c.disputeRef,{status:'resolved_administratively',decision});
  tx.update(c.queueRef,{status:'resolved_administratively'});
  tx.create(auditRef,{id:auditId,action:'admin.freelance.hourly_cancellation_resolved',actorId:uid,actorRole:'super_admin',targetType:'freelance_hourly_cancellation_review',targetId:id,sourceDigest:b.sourceDigest,recognizedServiceMinor:amount,proposalDigest:decision.proposalDigest,evidenceDigest:decision.evidenceDigest,reasonHash,bankVerified:false,source:'server',createdAt:FieldValue.serverTimestamp()});
  release();writeFreelanceFinancialNotices(tx,c.record.commitment,'hourly_cancellation_admin_resolved',now,'both','dispute');
  return {status:'resolved_administratively',replay:false,bankVerified:false};
 });
}

export async function getHourlyCancellationAttachment(auth:string,id:unknown,attachmentId:unknown){
 if(!validFreelanceId(id)||!validFreelanceId(attachmentId))throw Error('FREELANCE_INVALID');
 const uid=await actor(auth);
 return adminDb.runTransaction(async tx=>{
  await role(tx,uid);
  const q=(await tx.get(adminDb.doc('freelanceHourlyCancellationReviewsV1/'+id))).data();
  if(!q||!validFreelanceId(q.requesterUid)||!validFreelanceId(q.beneficiaryUid)||[q.requesterUid,q.beneficiaryUid].includes(uid))throw Error('FORBIDDEN');
  const c=await readHourlyCancellationAgreementContext(tx,q.requesterUid,id);
  if(!c.dispute?.requestedAt||c.dispute.status!=='review_requested')return fail();
  return readHourlyAttachment(tx,c.evidence,attachmentId);
 },{readOnly:true});
}
