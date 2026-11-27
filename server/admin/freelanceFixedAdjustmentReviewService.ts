import {projectHourlyReviewNotes,projectHourlyAttachments,readHourlyAttachment} from '../freelance/freelanceHourlyReviewNotes.js';
import {isFinancialReviewOutcome} from '../freelance/freelanceExternalPaymentStatementService.js';
import {createHash} from 'node:crypto';
import {FieldPath,FieldValue} from 'firebase-admin/firestore';
import {adminDb} from '../firebaseAdmin.js';
import {requireKyrubSessionMfa} from '../identity/kyrubMfaAuthorization.js';
import {validFreelanceId} from '../../shared/freelanceLifecycle.js';
import {financialReviewAdminEnabled} from './freelanceFinancialReviewService.js';
import {readAdjustmentStatementContext} from '../freelance/freelanceFixedAdjustmentStatementService.js';
import {prepareAdjustmentRestriction} from '../freelance/freelanceEngagementRestrictionService.js';
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

export async function listFixedAdjustmentReviews(auth:string,cursor:unknown){
 if(cursor!==undefined&&cursor!==''&&!validFreelanceId(cursor))throw Error('FREELANCE_INVALID');
 const uid=await actor(auth);
 return adminDb.runTransaction(async tx=>{
  await role(tx,uid);
  let q=adminDb.collection('freelanceFixedAdjustmentReviewsV1').where('status','==','pending').orderBy(FieldPath.documentId()).limit(21);
  if(typeof cursor==='string'&&cursor)q=q.startAfter(cursor);
  const page=await tx.get(q),docs=page.docs.slice(0,20),items=[];
  for(const doc of docs){
   const r=doc.data();
   if(r.offerId!==doc.id||!validFreelanceId(r.payerUid)||!validFreelanceId(r.recipientUid))return fail();
   if([r.payerUid,r.recipientUid].includes(uid))continue;
   const x=await readAdjustmentStatementContext(tx,r.payerUid,doc.id);
   if(!x.restricted||x.queue?.status!=='pending')return fail();
   items.push({offerId:doc.id,title:x.c.offer.title,sourceDigest:x.o.sourceDigest,requestedAt:x.queue.requestedAt,direction:x.o.direction,amountMinor:x.o.amountMinor,statementDigest:x.statementDigest,evidenceDigest:x.evidence.digest,statements:x.events.map(e=>({role:e.actorUid===x.o.payerUid?'payer':'recipient',statement:e.statement,recordedAt:e.recordedAt})),notes:projectHourlyReviewNotes(x.evidence.notes,x.c.obligation),attachments:projectHourlyAttachments(x.evidence.attachments,x.c.obligation),bankVerified:false});
  }
  return {items,nextCursor:page.size>20?docs.at(-1)!.id:null};
 },{readOnly:true});
}
export async function decideFixedAdjustmentReview(auth:string,input:unknown){
 if(!input||typeof input!=='object'||Array.isArray(input))throw Error('FREELANCE_INVALID');
 const b=input as Record<string,unknown>;
 if(Object.keys(b).length!==9||Object.keys(b).some(k=>!['offerId','sourceDigest','expectedAmountMinor','expectedRequestedAt','statementDigest','evidenceDigest','outcome','reason','confirmed'].includes(k))||!validFreelanceId(b.offerId)||![b.sourceDigest,b.statementDigest,b.evidenceDigest].every(v=>typeof v==='string'&&/^[a-f0-9]{64}$/.test(v))||!Number.isSafeInteger(b.expectedAmountMinor)||Number(b.expectedAmountMinor)<1||typeof b.expectedRequestedAt!=='string'||!isFinancialReviewOutcome(b.outcome)||typeof b.reason!=='string'||b.reason.trim().length<10||b.reason.trim().length>1000||b.confirmed!==true)throw Error('FREELANCE_INVALID');
 const id=b.offerId,outcome=b.outcome,reason=b.reason.trim(),uid=await actor(auth);
 const auditId='freelance_fixed_adjustment_'+createHash('sha256').update(id).digest('hex');
 return adminDb.runTransaction(async tx=>{
  await role(tx,uid);
  const q=(await tx.get(adminDb.doc('freelanceFixedAdjustmentReviewsV1/'+id))).data();
  if(!q||!validFreelanceId(q.payerUid)||!validFreelanceId(q.recipientUid))return fail();
  if([q.payerUid,q.recipientUid].includes(uid))throw Error('FORBIDDEN');
  const x=await readAdjustmentStatementContext(tx,q.payerUid,id);
  if(!x.queue||x.o.sourceDigest!==b.sourceDigest||x.o.amountMinor!==b.expectedAmountMinor||x.queue.requestedAt!==b.expectedRequestedAt||x.statementDigest!==b.statementDigest||x.evidence.digest!==b.evidenceDigest)return fail();
  const auditRef=adminDb.doc('kyrub_admin/control_plane/audit_logs/'+auditId),audit=await tx.get(auditRef),reasonHash=createHash('sha256').update(reason).digest('hex');
  if(x.queue.status==='resolved_administratively'){
   const d=x.queue.decision!;
   if(d.actorUid!==uid||d.outcome!==outcome||d.reason!==reason||!audit.exists||audit.get('actorId')!==uid||audit.get('targetId')!==id||audit.get('sourceDigest')!==b.sourceDigest||audit.get('amountMinor')!==b.expectedAmountMinor||audit.get('outcome')!==outcome||audit.get('reasonHash')!==reasonHash||audit.get('statementDigest')!==b.statementDigest||audit.get('evidenceDigest')!==b.evidenceDigest)return fail();
   return {status:x.queue.status,replay:true,bankVerified:false};
  }
  if(x.queue.status!=='pending'||!x.restricted||audit.exists)return fail();
  for(const a of x.evidence.attachments)await readHourlyAttachment(tx,x.evidence,a.id);
  const release=await prepareAdjustmentRestriction(tx,x.c.obligation,true,false),now=new Date().toISOString();
  if(Date.parse(now)<Date.parse(x.queue.requestedAt))return fail();
  const decision={actorUid:uid,outcome,reason,decidedAt:now,statementDigest:x.statementDigest,evidenceDigest:x.evidence.digest,bankVerified:false};
  tx.update(x.queueRef,{status:'resolved_administratively',resolvedAt:now,decision});
  tx.create(auditRef,{id:auditId,action:'admin.freelance.fixed_adjustment_resolved',actorId:uid,actorRole:'super_admin',targetType:'freelance_fixed_adjustment_review',targetId:id,sourceDigest:x.o.sourceDigest,amountMinor:x.o.amountMinor,outcome,reasonHash,statementDigest:x.statementDigest,evidenceDigest:x.evidence.digest,bankVerified:false,source:'server',createdAt:FieldValue.serverTimestamp()});
  release();writeFreelanceFinancialNotices(tx,x.c.obligation,'fixed_cancellation_adjustment_admin_resolved',now,'both',x.o.sourceDigest);
  return {status:'resolved_administratively',replay:false,bankVerified:false};
 });
}
export async function getFixedAdjustmentAttachment(auth:string,id:unknown,attachmentId:unknown){
 if(!validFreelanceId(id)||!validFreelanceId(attachmentId))throw Error('FREELANCE_INVALID');
 const uid=await actor(auth);
 return adminDb.runTransaction(async tx=>{
  await role(tx,uid);
  const q=(await tx.get(adminDb.doc('freelanceFixedAdjustmentReviewsV1/'+id))).data();
  if(!q||!validFreelanceId(q.payerUid)||!validFreelanceId(q.recipientUid)||[q.payerUid,q.recipientUid].includes(uid))throw Error('FORBIDDEN');
  const x=await readAdjustmentStatementContext(tx,q.payerUid,id);
  if(x.queue?.status!=='pending'||!x.restricted)return fail();
  return readHourlyAttachment(tx,x.evidence,attachmentId);
 },{readOnly:true});
}
