import {readAdvanceReviews,advanceReviewRecord,paymentDigest,type AdvanceReview} from './freelanceHourlyAdvanceReviewRecords.js';
import type {Transaction} from 'firebase-admin/firestore';
import {adminDb} from '../firebaseAdmin.js';
import {readAttendanceContext} from './freelanceAttendanceScheduleService.js';
import {buildFreelanceHourlyCommitment} from '../../shared/freelanceVariablePaymentBasis.js';
import {appendHourlyAdvance,projectHourlyAdvances,type HourlyAdvanceEvent} from '../../shared/freelanceHourlyReconciliation.js';
import {canonicalVariablePaymentRecord,digestVariablePaymentSources} from './freelanceVariablePaymentBasisService.js';
import {prepareHourlyAdvanceRestriction} from './freelanceEngagementRestrictionService.js';
import {validFreelanceId} from '../../shared/freelanceLifecycle.js';

const fail=():never=>{throw Error('FREELANCE_HOURLY_RECONCILIATION_CONFLICT');};
const enabled=()=>{if(process.env.KYRUB_FREELANCE_HOURLY_ADVANCES_TEST_ONLY!=='true')throw Error('FREELANCE_FORBIDDEN');};
/** No public transport. Strict emulator gate inherited from attendance context.
 * Any history disables the legacy full-value settlement path until the
 * directional settlement integration is delivered. */
export async function readHourlyAdvanceContext(tx:Transaction,uid:string,id:string){
 enabled();
 const c=await readAttendanceContext(tx,uid,id),commitment=buildFreelanceHourlyCommitment(c.offer,c.application);
 const direct=c.ref.collection('directPayment'),historyRef=direct.doc('hourlyAdvances');
 const [saved,history,fixed,fixedHistory,final,finalHistory,frozen]=await tx.getAll(direct.doc('hourlyCommitment'),historyRef,direct.doc('obligation'),direct.doc('externalStatements'),direct.doc('hourlyFinalObligation'),direct.doc('hourlyStatements'),direct.doc('hourlyReconciliation'));
 if(!saved.exists||canonicalVariablePaymentRecord(saved.data())!==canonicalVariablePaymentRecord(commitment)||fixed.exists||fixedHistory.exists||finalHistory.exists)return fail();
 const raw=history.data(),commitmentDigest=digestVariablePaymentSources(commitment);
 let events:HourlyAdvanceEvent[]=[];
 if(raw){
  if(Object.keys(raw).length!==4||raw.schemaVersion!==1||raw.offerId!==id||raw.commitmentDigest!==commitmentDigest||!Array.isArray(raw.events)||!raw.events.length)return fail();
  events=raw.events;
 }
 const review=await readAdvanceReviews(tx,commitment,events);
 const projection=projectHourlyAdvances(commitment,events,null,review.recognitions);
 const restricted=projection.disputedCount>0;
 await prepareHourlyAdvanceRestriction(tx,commitment,restricted,restricted);
 return {c,commitment,commitmentDigest,historyRef,events,projection,restricted,finalExists:final.exists,frozen,review};
}
export async function readHourlyAdvances(uid:string,id:string){
 return adminDb.runTransaction(async tx=>{
  const x=await readHourlyAdvanceContext(tx,uid,id);
  return {offerId:id,role:x.c.actor,revision:x.events.length,...x.projection,restrictionActive:x.restricted,reviews:x.review.reviews.map(r=>({paymentId:r.paymentId,sourceDigest:r.sourceDigest,status:r.status,requestedAt:r.requestedAt,decision:r.decision?{recognizedMinor:r.decision.recognizedMinor,reason:r.decision.reason,decidedAt:r.decision.decidedAt}:null})),
   events:x.events.map(e=>({id:e.id,paymentId:e.paymentId,role:e.actorUid===x.commitment.requesterUid?'requester':'worker',statement:e.statement,amountMinor:e.amountMinor,recordedAt:e.recordedAt}))};
 },{readOnly:true});
}
export async function recordHourlyAdvance(uid:string,id:string,input:unknown){
 enabled();
 if(!input||typeof input!=='object'||Array.isArray(input))throw Error('FREELANCE_INVALID');
 const b=input as Record<string,unknown>;
 if(Object.keys(b).length!==6||Object.keys(b).some(k=>!['eventId','paymentId','statement','amountMinor','expectedRevision','confirmed'].includes(k))||!validFreelanceId(b.eventId)||!validFreelanceId(b.paymentId)||!['paid','received','not_received'].includes(String(b.statement))||typeof b.statement!=='string'||!Number.isSafeInteger(b.amountMinor)||Number(b.amountMinor)<1||!Number.isSafeInteger(b.expectedRevision)||Number(b.expectedRevision)<0||b.confirmed!==true)throw Error('FREELANCE_INVALID');
 return adminDb.runTransaction(async tx=>{
  const x=await readHourlyAdvanceContext(tx,uid,id);
  if(uid!==(b.statement==='paid'?x.commitment.requesterUid:x.commitment.beneficiaryUid))throw Error('FREELANCE_FORBIDDEN');
  const event:HourlyAdvanceEvent={id:b.eventId as string,paymentId:b.paymentId as string,actorUid:uid,statement:b.statement as HourlyAdvanceEvent['statement'],amountMinor:b.amountMinor as number,recordedAt:new Date().toISOString()};
  // New payment identity is payer-originated. The worker must respond to
  // that same identity; never invent a second row for the same transfer.
  if(event.statement!=='paid'&&!x.events.some(e=>e.paymentId===event.paymentId&&e.statement==='paid'))return fail();
  const next=appendHourlyAdvance(x.commitment,x.events,event,x.review.recognitions);
  if(!next.changed)return {changed:false,revision:x.events.length,state:x.projection.state,restrictionActive:x.restricted,bankVerified:false as const};
  const activeReview=x.review.reviews.find(r=>r.paymentId===event.paymentId);
  if(x.frozen.exists||b.expectedRevision!==x.events.length||activeReview&&activeReview.status!=='pending')return fail();
  if(activeReview&&next.disputedPaymentIds.includes(event.paymentId))return fail();
  // After the operational cut-off, only responses to previously declared
  // payments can be appended. Never add new paid declarations retroactively.
  const open=['contracted','in_progress','completion_requested'].includes(x.c.offer.status)&&!x.finalExists;
  if(!open&&(event.statement==='paid'||!['completed','cancelled','under_review'].includes(x.c.offer.status)))return fail();
  const restricted=next.disputedCount>0,write=await prepareHourlyAdvanceRestriction(tx,x.commitment,x.restricted,restricted);
  tx.set(x.historyRef,{schemaVersion:1,offerId:id,commitmentDigest:x.commitmentDigest,events:next.events});
  if(activeReview){const closed:AdvanceReview={...activeReview,status:'resolved_voluntarily',resolvedAt:event.recordedAt};tx.set(x.review.ref,advanceReviewRecord(x.commitment,x.review.reviews.map(r=>r===activeReview?closed:r)));}
  write();
  return {changed:true,revision:next.events.length,state:next.state,restrictionActive:restricted,bankVerified:false as const};
 });
}

export async function requestHourlyAdvanceReview(uid:string,id:string,input:unknown){
 if(!input||typeof input!=='object'||Array.isArray(input))throw Error('FREELANCE_INVALID');
 const b=input as Record<string,unknown>;
 if(Object.keys(b).length!==3||b.confirmed!==true||!validFreelanceId(b.paymentId)||typeof b.sourceDigest!=='string'||!/^[a-f0-9]{64}$/.test(b.sourceDigest))throw Error('FREELANCE_INVALID');
 const paymentId=b.paymentId as string;
 return adminDb.runTransaction(async tx=>{
  const x=await readHourlyAdvanceContext(tx,uid,id);
  if(x.frozen.exists||!x.projection.disputedPaymentIds.includes(paymentId)||b.sourceDigest!==paymentDigest(x.events,paymentId))return fail();
  const prior=x.review.reviews.find(r=>r.paymentId===paymentId);
  if(prior){if(prior.status!=='pending')return fail();return {created:false,requestedAt:prior.requestedAt};}
  const requestedAt=new Date().toISOString();
  const r:AdvanceReview={paymentId,sourceDigest:b.sourceDigest as string,requestedBy:uid,requestedAt,status:'pending'};
  tx.set(x.review.ref,advanceReviewRecord(x.commitment,[...x.review.reviews,r]));
  return {created:true,requestedAt};
 });
}
