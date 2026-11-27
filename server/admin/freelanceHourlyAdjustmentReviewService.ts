import {createHash} from 'node:crypto';
import {FieldPath,FieldValue,type Transaction} from 'firebase-admin/firestore';
import {adminDb} from '../firebaseAdmin.js';
import {requireKyrubSessionMfa} from '../identity/kyrubMfaAuthorization.js';
import {financialReviewAdminEnabled} from './freelanceFinancialReviewService.js';
import {readHourlyAdjustmentContext,hourlyAdjustmentAuditId} from '../freelance/freelanceHourlyAdjustmentService.js';
import {isFinancialReviewOutcome} from '../freelance/freelanceExternalPaymentStatementService.js';
import {prepareAdjustmentRestriction} from '../freelance/freelanceEngagementRestrictionService.js';
import {projectHourlyReviewNotes,projectHourlyAttachments} from '../freelance/freelanceHourlyReviewNotes.js';
import {writeFreelanceFinancialNotices} from '../freelance/freelanceFinancialNoticeService.js';
import {validFreelanceId} from '../../shared/freelanceLifecycle.js';

const fail=():never=>{throw Error('FREELANCE_HOURLY_RECONCILIATION_CONFLICT');};
async function administrator(authorization:string){
 if(!financialReviewAdminEnabled()||process.env.KYRUB_FREELANCE_HOURLY_ADVANCES_TEST_ONLY!=='true')throw Error('FREELANCE_FINANCIAL_REVIEW_DISABLED');
 const identity=await requireKyrubSessionMfa(authorization,'administrative',300);
 if(identity.email_verified!==true||!validFreelanceId(identity.uid))throw Error('FORBIDDEN');
 return identity.uid;
}
async function role(tx:Transaction,uid:string){
 const r=(await tx.get(adminDb.doc('kyrub_admin/control_plane/admins/'+uid))).data();
 if(!r||r.uid!==uid||r.role!=='super_admin'||r.status!=='active')throw Error('FORBIDDEN');
}
function participants(raw:FirebaseFirestore.DocumentData|undefined,id:string){
 if(!raw||raw.offerId!==id||!validFreelanceId(raw.payerUid)||!validFreelanceId(raw.recipientUid)||raw.payerUid===raw.recipientUid)return fail();
 return [raw.payerUid,raw.recipientUid] as string[];
}
export async function listHourlyAdjustmentReviews(authorization:string,cursor?:unknown){
 const uid=await administrator(authorization);
 if(cursor!==undefined&&cursor!==''&&!validFreelanceId(cursor))throw Error('FREELANCE_INVALID');
 return adminDb.runTransaction(async tx=>{
  await role(tx,uid);
  let q=adminDb.collection('freelanceHourlyAdjustmentReviewsV1').where('status','==','pending').orderBy(FieldPath.documentId()).limit(21);
  if(typeof cursor==='string'&&cursor)q=q.startAfter(cursor);
  const results=await tx.get(q),page=results.docs.slice(0,20),items=[];
  for(const doc of page){
   const ids=participants(doc.data(),doc.id);
   if(ids.includes(uid))continue;
   const c=await readHourlyAdjustmentContext(tx,ids[0],doc.id);
   if(!c.expected||!c.issued||!c.restricted||c.queue?.status!=='pending')return fail();
   const o=c.expected,p=c.x.x.commitment;
   items.push({offerId:doc.id,sourceDigest:o.sourceDigest,amountMinor:o.amountMinor,direction:o.direction,requestedAt:c.queue.requestedAt,statementDigest:c.statementDigest,evidenceDigest:c.evidence.digest,
    statements:c.events.map(e=>({role:e.actorUid===o.payerUid?'payer':'recipient',statement:e.statement,recordedAt:e.recordedAt})),
    evidenceNotes:projectHourlyReviewNotes(c.evidence.notes,p),attachments:projectHourlyAttachments(c.evidence.attachments,p),restrictionActive:true,bankVerified:false});
  }
  return {items,nextCursor:results.size>20?page.at(-1)!.id:null};
 },{readOnly:true});
}
export async function decideHourlyAdjustmentReview(authorization:string,input:unknown){
 const uid=await administrator(authorization);
 if(!input||typeof input!=='object'||Array.isArray(input))throw Error('FREELANCE_INVALID');
 const b=input as Record<string,unknown>;
 if(Object.keys(b).length!==8||b.confirmed!==true||!validFreelanceId(b.offerId)||typeof b.expectedRequestedAt!=='string'||!Number.isFinite(Date.parse(b.expectedRequestedAt))||
 !['sourceDigest','statementDigest','evidenceDigest'].every(k=>typeof b[k]==='string'&&/^[a-f0-9]{64}$/.test(b[k] as string))||!isFinancialReviewOutcome(b.outcome)||typeof b.reason!=='string'||b.reason.trim().length<10||b.reason.trim().length>1000)throw Error('FREELANCE_INVALID');
 const id=b.offerId as string,outcome=b.outcome,reason=b.reason.trim(),reasonHash=createHash('sha256').update(reason).digest('hex');
 return adminDb.runTransaction(async tx=>{
  await role(tx,uid);
  const entry=await tx.get(adminDb.doc('freelanceHourlyAdjustmentReviewsV1/'+id)),ids=participants(entry.data(),id);
  if(ids.includes(uid))throw Error('FORBIDDEN');
  const c=await readHourlyAdjustmentContext(tx,ids[0],id),o=c.expected,q=c.queue;
  if(!o||!q||!c.issued||o.sourceDigest!==b.sourceDigest||q.requestedAt!==b.expectedRequestedAt||c.statementDigest!==b.statementDigest||c.evidence.digest!==b.evidenceDigest)return fail();
  if(q.status==='resolved_administratively'){
   if(q.decision?.actorUid!==uid||q.decision.outcome!==outcome||q.decision.reason!==reason)return fail();
   return {status:q.status,outcome,replay:true,bankVerified:false as const};
  }
  if(q.status!=='pending'||!c.restricted||c.projection?.state!=='disputed')return fail();
  const decidedAt=new Date().toISOString();
  if(Date.parse(decidedAt)<Date.parse(q.requestedAt))return fail();
  const release=await prepareAdjustmentRestriction(tx,c.x.x.commitment,true,false);
  const decision={actorUid:uid,outcome,reason,decidedAt,statementDigest:c.statementDigest,evidenceDigest:c.evidence.digest,bankVerified:false as const};
  tx.update(c.queueRef,{status:'resolved_administratively',resolvedAt:decidedAt,decision});
  tx.create(c.auditRef,{id:hourlyAdjustmentAuditId(id),action:'admin.freelance.hourly_adjustment_review_resolved',actorId:uid,actorRole:'super_admin',targetType:'freelance_hourly_adjustment_review',targetId:id,sourceDigest:o.sourceDigest,outcome,reasonHash,statementDigest:c.statementDigest,evidenceDigest:c.evidence.digest,bankVerified:false,source:'server',createdAt:FieldValue.serverTimestamp()});
  release();
  writeFreelanceFinancialNotices(tx,c.x.x.commitment,'hourly_adjustment_admin_resolved',decidedAt,'both',o.sourceDigest);
  return {status:'resolved_administratively' as const,outcome,replay:false,bankVerified:false as const};
 });
}
