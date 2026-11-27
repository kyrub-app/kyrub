import {createHash} from 'node:crypto';
import {FieldValue,type Transaction} from 'firebase-admin/firestore';
import {adminDb} from '../firebaseAdmin.js';
import {requireKyrubSessionMfa} from '../identity/kyrubMfaAuthorization.js';
import {financialReviewAdminEnabled} from './freelanceFinancialReviewService.js';
import {readHourlyAdvanceContext} from '../freelance/freelanceHourlyAdvanceService.js';
import {advanceReviewRef,advanceAuditRef,advanceReviewRecord,paymentDigest,type AdvanceReview} from '../freelance/freelanceHourlyAdvanceReviewRecords.js';
import {projectHourlyAdvances} from '../../shared/freelanceHourlyReconciliation.js';
import {prepareHourlyAdvanceRestriction} from '../freelance/freelanceEngagementRestrictionService.js';
import {validFreelanceId} from '../../shared/freelanceLifecycle.js';
const fail=():never=>{throw Error('FREELANCE_HOURLY_RECONCILIATION_CONFLICT');};
async function admin(authorization:string){
 if(!financialReviewAdminEnabled()||process.env.KYRUB_FREELANCE_HOURLY_ADVANCES_TEST_ONLY!=='true')throw Error('FREELANCE_FINANCIAL_REVIEW_DISABLED');
 const identity=await requireKyrubSessionMfa(authorization,'administrative',300);
 if(identity.email_verified!==true||!validFreelanceId(identity.uid))throw Error('FORBIDDEN');
 return identity.uid;
}
async function context(tx:Transaction,uid:string,id:string){
 const [role,entry]=await tx.getAll(adminDb.doc('kyrub_admin/control_plane/admins/'+uid),advanceReviewRef(id));
 if(role.get('uid')!==uid||role.get('role')!=='super_admin'||role.get('status')!=='active')throw Error('FORBIDDEN');
 const raw=entry.data();
 if(!raw||raw.offerId!==id||!validFreelanceId(raw.requesterUid)||!validFreelanceId(raw.beneficiaryUid))return fail();
 if([raw.requesterUid,raw.beneficiaryUid].includes(uid))throw Error('FORBIDDEN');
 return readHourlyAdvanceContext(tx,raw.requesterUid,id);
}
/** Targeted review read; no collection-wide access or Pix data. */
export async function readHourlyAdvanceAdminReview(authorization:string,id:string){
 const uid=await admin(authorization);
 if(!validFreelanceId(id))throw Error('FREELANCE_INVALID');
 return adminDb.runTransaction(async tx=>{
  const x=await context(tx,uid,id);
  return {offerId:id,items:x.review.reviews.map(r=>({paymentId:r.paymentId,sourceDigest:r.sourceDigest,requestedAt:r.requestedAt,status:r.status,
   statements:x.events.filter(e=>e.paymentId===r.paymentId).map(e=>({role:e.actorUid===x.commitment.requesterUid?'requester':'worker',statement:e.statement,amountMinor:e.amountMinor,recordedAt:e.recordedAt})),
   decision:r.decision?{recognizedMinor:r.decision.recognizedMinor,reason:r.decision.reason,decidedAt:r.decision.decidedAt}:null})),bankVerified:false};
 },{readOnly:true});
}
export async function decideHourlyAdvanceReview(authorization:string,input:unknown){
 const uid=await admin(authorization);
 if(!input||typeof input!=='object'||Array.isArray(input))throw Error('FREELANCE_INVALID');
 const b=input as Record<string,unknown>;
 if(Object.keys(b).length!==7||b.confirmed!==true||!validFreelanceId(b.offerId)||!validFreelanceId(b.paymentId)||typeof b.expectedRequestedAt!=='string'||typeof b.sourceDigest!=='string'||!/^[a-f0-9]{64}$/.test(b.sourceDigest)||!Number.isSafeInteger(b.recognizedMinor)||Number(b.recognizedMinor)<0||typeof b.reason!=='string'||b.reason.trim().length<10||b.reason.trim().length>1000)throw Error('FREELANCE_INVALID');
 const id=b.offerId as string,paymentId=b.paymentId as string,recognizedMinor=Number(b.recognizedMinor),reason=b.reason.trim();
 return adminDb.runTransaction(async tx=>{
  const x=await context(tx,uid,id),r=x.review.reviews.find(r=>r.paymentId===paymentId);
  if(!r||r.sourceDigest!==b.sourceDigest||r.requestedAt!==b.expectedRequestedAt)return fail();
  if(r.status==='resolved_administratively'){
   if(r.decision?.actorUid!==uid||r.decision.reason!==reason||r.decision.recognizedMinor!==recognizedMinor)return fail();
   return {replay:true,restrictionActive:x.restricted,bankVerified:false as const};
  }
  if(r.status!=='pending'||x.frozen.exists||!x.projection.disputedPaymentIds.includes(paymentId)||paymentDigest(x.events,paymentId)!==r.sourceDigest)return fail();
  const next=projectHourlyAdvances(x.commitment,x.events,null,[...x.review.recognitions,{paymentId,recognizedMinor}]);
  const restricted=next.disputedCount>0,release=await prepareHourlyAdvanceRestriction(tx,x.commitment,true,restricted);
  const audit=advanceAuditRef(id,paymentId);
  if((await tx.get(audit)).exists)return fail();
  const decidedAt=new Date().toISOString();
  if(Date.parse(decidedAt)<Date.parse(r.requestedAt))return fail();
  const decision={actorUid:uid,recognizedMinor,reason,decidedAt,bankVerified:false as const};
  const closed:AdvanceReview={...r,status:'resolved_administratively',resolvedAt:decidedAt,decision};
  tx.set(x.review.ref,advanceReviewRecord(x.commitment,x.review.reviews.map(v=>v===r?closed:v)));
  tx.create(audit,{id:audit.id,action:'admin.freelance.hourly_advance_review_resolved',actorId:uid,actorRole:'super_admin',targetType:'freelance_hourly_advance_review',targetId:id,paymentId,sourceDigest:r.sourceDigest,recognizedMinor,reasonHash:createHash('sha256').update(reason).digest('hex'),bankVerified:false,source:'server',createdAt:FieldValue.serverTimestamp()});
  release();
  return {replay:false,restrictionActive:restricted,bankVerified:false as const};
 });
}
