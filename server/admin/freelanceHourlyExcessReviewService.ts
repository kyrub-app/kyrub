import {projectHourlyReviewNotes,projectHourlyAttachments,readHourlyAttachment} from '../freelance/freelanceHourlyReviewNotes.js';
import {buildHourlyExcessAdministrativeResolution,buildHourlyExcessObligation,readHourlyExcessContext} from '../freelance/freelanceHourlyExcessReviewService.js';
import {digestVariablePaymentSources} from '../freelance/freelanceVariablePaymentBasisService.js';
import {createHash} from 'node:crypto';
import {FieldPath,FieldValue} from 'firebase-admin/firestore';
import {adminDb} from '../firebaseAdmin.js';
import {requireKyrubSessionMfa} from '../identity/kyrubMfaAuthorization.js';
import {validFreelanceId} from '../../shared/freelanceLifecycle.js';
import {financialReviewAdminEnabled} from './freelanceFinancialReviewService.js';
import {prepareExcessRestriction} from '../freelance/freelanceEngagementRestrictionService.js';
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
export async function listHourlyExcessReviews(auth:string,cursor:unknown){
 if(cursor!==undefined&&cursor!==''&&!validFreelanceId(cursor))throw Error('FREELANCE_INVALID');
 const uid=await actor(auth);
 return adminDb.runTransaction(async tx=>{
  await role(tx,uid);
  let q=adminDb.collection('freelanceHourlyExcessReviewsV1').where('status','==','pending').orderBy(FieldPath.documentId()).limit(21);
  if(typeof cursor==='string'&&cursor)q=q.startAfter(cursor);
  const page=await tx.get(q),docs=page.docs.slice(0,20),items=[];
  for(const doc of docs){
   const r=doc.data();
   if(r.offerId!==doc.id||!validFreelanceId(r.requesterUid)||!validFreelanceId(r.beneficiaryUid))return fail();
   if([r.requesterUid,r.beneficiaryUid].includes(uid))continue;
   const c=await readHourlyExcessContext(tx,r.requesterUid,doc.id);
   if(!c.restricted||c.dispute?.status!=='review_requested')return fail();
   items.push({offerId:doc.id,title:c.c.offer.title,sourceDigest:c.record.sourceDigest,requestedAt:c.dispute.requestedAt,authorizedMinor:c.record.accounting.withinCapReferenceMinor,hourlyRateMinor:c.record.accounting.hourlyRateMinor,recordedMs:c.record.accounting.compensableMs,excessMs:c.record.accounting.excessMs,proposal:c.proposal,proposalDigest:digestVariablePaymentSources(c.proposal),evidenceDigest:c.evidence.digest,notes:projectHourlyReviewNotes(c.evidence.notes,c.record.commitment),attachments:projectHourlyAttachments(c.evidence.attachments,c.record.commitment),bankVerified:false});
  }
  return {items,nextCursor:page.size>20?docs.at(-1)!.id:null};
 },{readOnly:true});
}
export async function decideHourlyExcessReview(auth:string,input:unknown){
 if(!input||typeof input!=='object'||Array.isArray(input))throw Error('FREELANCE_INVALID');
 const b=input as Record<string,unknown>;
 if(Object.keys(b).length!==8||Object.keys(b).some(k=>!['offerId','sourceDigest','expectedRequestedAt','proposalDigest','evidenceDigest','recognizedExcessMs','reason','confirmed'].includes(k))||!validFreelanceId(b.offerId)||typeof b.sourceDigest!=='string'||!/^[a-f0-9]{64}$/.test(b.sourceDigest)||typeof b.expectedRequestedAt!=='string'||typeof b.evidenceDigest!=='string'||!/^[a-f0-9]{64}$/.test(b.evidenceDigest)||typeof b.proposalDigest!=='string'||!/^[a-f0-9]{64}$/.test(b.proposalDigest)||typeof b.recognizedExcessMs!=='number'||!Number.isSafeInteger(b.recognizedExcessMs)||b.recognizedExcessMs<0||typeof b.reason!=='string'||b.reason.trim().length<10||b.reason.trim().length>1000||b.confirmed!==true)throw Error('FREELANCE_INVALID');
 const id=b.offerId,amount=b.recognizedExcessMs,reason=b.reason.trim(),uid=await actor(auth);
 const auditId='freelance_hourly_excess_'+createHash('sha256').update(id).digest('hex');
 return adminDb.runTransaction(async tx=>{
  await role(tx,uid);
  const queue=(await tx.get(adminDb.doc('freelanceHourlyExcessReviewsV1/'+id))).data();
  if(!queue||!validFreelanceId(queue.requesterUid)||!validFreelanceId(queue.beneficiaryUid))return fail();
  if([queue.requesterUid,queue.beneficiaryUid].includes(uid))throw Error('FORBIDDEN');
  const c=await readHourlyExcessContext(tx,queue.requesterUid,id);
  if(!c.dispute||c.record.sourceDigest!==b.sourceDigest||c.dispute.requestedAt!==b.expectedRequestedAt||amount>c.record.accounting.excessMs||b.proposalDigest!==digestVariablePaymentSources(c.proposal)||b.evidenceDigest!==c.evidence.digest)return fail();
  const auditRef=adminDb.doc('kyrub_admin/control_plane/audit_logs/'+auditId),audit=await tx.get(auditRef),reasonHash=createHash('sha256').update(reason).digest('hex');
  if(c.dispute.status==='resolved_administratively'){
   const d=c.dispute.decision!;
   if(d.actorUid!==uid||d.reason!==reason||d.recognizedExcessMs!==amount||!audit.exists||audit.get('actorId')!==uid||audit.get('targetId')!==id||audit.get('sourceDigest')!==b.sourceDigest||audit.get('reasonHash')!==reasonHash||audit.get('recognizedExcessMs')!==amount||audit.get('proposalDigest')!==b.proposalDigest||audit.get('evidenceDigest')!==b.evidenceDigest)return fail();
   return {status:c.dispute.status,replay:true,bankVerified:false};
  }
  if(c.dispute.status!=='review_requested'||!c.restricted||audit.exists)return fail();
  for(const a of c.evidence.attachments)await readHourlyAttachment(tx,c.evidence,a.id);
  const release=await prepareExcessRestriction(tx,c.record.commitment,true,false),now=new Date().toISOString();
  if(Date.parse(now)<Date.parse(c.dispute.requestedAt!))return fail();
  const decision={actorUid:uid,recognizedExcessMs:amount,reason,decidedAt:now,proposalDigest:digestVariablePaymentSources(c.proposal),evidenceDigest:c.evidence.digest};
  const resolution=buildHourlyExcessAdministrativeResolution(c.record,decision);
  const final=buildHourlyExcessObligation(c.record,resolution);
  tx.create(c.resolutionRef,resolution);if(final)tx.create(c.finalRef,final);
  tx.update(c.disputeRef,{status:'resolved_administratively',decision});
  tx.update(c.queueRef,{status:'resolved_administratively'});
  tx.create(auditRef,{id:auditId,action:'admin.freelance.hourly_excess_resolved',actorId:uid,actorRole:'super_admin',targetType:'freelance_hourly_excess_review',targetId:id,sourceDigest:b.sourceDigest,recognizedExcessMs:amount,proposalDigest:decision.proposalDigest,evidenceDigest:decision.evidenceDigest,reasonHash,bankVerified:false,source:'server',createdAt:FieldValue.serverTimestamp()});
  release();writeFreelanceFinancialNotices(tx,c.record.commitment,'hourly_excess_admin_resolved',now,'both','dispute');
  return {status:'resolved_administratively',replay:false,bankVerified:false};
 });
}

export async function getHourlyExcessAttachment(auth:string,id:unknown,attachmentId:unknown){
 if(!validFreelanceId(id)||!validFreelanceId(attachmentId))throw Error('FREELANCE_INVALID');
 const uid=await actor(auth);
 return adminDb.runTransaction(async tx=>{
  await role(tx,uid);
  const q=(await tx.get(adminDb.doc('freelanceHourlyExcessReviewsV1/'+id))).data();
  if(!q||!validFreelanceId(q.requesterUid)||!validFreelanceId(q.beneficiaryUid)||[q.requesterUid,q.beneficiaryUid].includes(uid))throw Error('FORBIDDEN');
  const c=await readHourlyExcessContext(tx,q.requesterUid,id);
  if(!c.dispute?.requestedAt||c.dispute.status!=='review_requested')return fail();
  return readHourlyAttachment(tx,c.evidence,attachmentId);
 },{readOnly:true});
}
