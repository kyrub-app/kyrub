import {createHash} from 'node:crypto';
import type {Transaction,DocumentReference} from 'firebase-admin/firestore';
import {adminDb} from '../firebaseAdmin.js';
import type {FreelanceHourlyCommitment} from '../../shared/freelanceVariablePaymentBasis.js';
import {projectHourlyAdvances,type HourlyAdvanceEvent,type HourlyAdvanceRecognition} from '../../shared/freelanceHourlyReconciliation.js';
import {validFreelanceId} from '../../shared/freelanceLifecycle.js';
import {digestVariablePaymentSources} from './freelanceVariablePaymentBasisService.js';
const fail=():never=>{throw Error('FREELANCE_HOURLY_RECONCILIATION_CONFLICT');};
const iso=(v:unknown):v is string=>typeof v==='string'&&Number.isFinite(Date.parse(v))&&new Date(Date.parse(v)).toISOString()===v;
export type AdvanceDecision={actorUid:string;recognizedMinor:number;reason:string;decidedAt:string;bankVerified:false};
export type AdvanceReview={paymentId:string;sourceDigest:string;requestedBy:string;requestedAt:string;status:'pending'|'resolved_voluntarily'|'resolved_administratively';resolvedAt?:string;decision?:AdvanceDecision};
export const advanceReviewRef=(id:string)=>adminDb.doc('freelanceHourlyAdvanceReviewsV1/'+id);
export const advanceAuditRef=(id:string,paymentId:string)=>adminDb.doc('kyrub_admin/control_plane/audit_logs/freelance_hourly_advance_review_'+digestVariablePaymentSources([id,paymentId]));
export const paymentDigest=(events:readonly HourlyAdvanceEvent[],paymentId:string)=>digestVariablePaymentSources(events.filter(e=>e.paymentId===paymentId));
export function advanceReviewRecord(c:FreelanceHourlyCommitment,reviews:AdvanceReview[]){return {schemaVersion:1,offerId:c.offerId,requesterUid:c.requesterUid,beneficiaryUid:c.beneficiaryUid,reviews};}
export async function readAdvanceReviews(tx:Transaction,c:FreelanceHourlyCommitment,events:HourlyAdvanceEvent[]){
 const ref=advanceReviewRef(c.offerId),raw=(await tx.get(ref)).data();
 const reviews:AdvanceReview[]=raw?.reviews??[],recognitions:HourlyAdvanceRecognition[]=[];
 if(raw&&(Object.keys(raw).length!==5||raw.schemaVersion!==1||raw.offerId!==c.offerId||raw.requesterUid!==c.requesterUid||raw.beneficiaryUid!==c.beneficiaryUid||!Array.isArray(raw.reviews)||!reviews.length||reviews.length>100))return fail();
 const seen=new Set<string>();
 for(const r of reviews){
  if(!r||!validFreelanceId(r.paymentId)||seen.has(r.paymentId)||![c.requesterUid,c.beneficiaryUid].includes(r.requestedBy)||!iso(r.requestedAt)||!['pending','resolved_voluntarily','resolved_administratively'].includes(r.status)||Object.keys(r).length!==(r.status==='pending'?5:r.status==='resolved_voluntarily'?6:7))return fail();
  seen.add(r.paymentId);
  const current=events.filter(e=>e.paymentId===r.paymentId);
  const before=r.status==='resolved_voluntarily'?current.slice(0,-1):current;
  if(!before.length||r.sourceDigest!==paymentDigest(before,r.paymentId)||Date.parse(r.requestedAt)<Date.parse(before.at(-1)!.recordedAt)||!projectHourlyAdvances(c,before,null).disputedPaymentIds.includes(r.paymentId))return fail();
  const audit=await tx.get(advanceAuditRef(c.offerId,r.paymentId));
  if(r.status==='pending'){
   if(r.resolvedAt!==undefined||r.decision!==undefined||audit.exists)return fail();
  }else if(!iso(r.resolvedAt)||Date.parse(r.resolvedAt)<Date.parse(r.requestedAt))return fail();
  else if(r.status==='resolved_voluntarily'){
   if(r.decision!==undefined||audit.exists||current.at(-1)?.recordedAt!==r.resolvedAt||projectHourlyAdvances(c,current,null).state!=='awaiting_accounting')return fail();
  }else{
   const d=r.decision;
   if(!d||Object.keys(d).length!==5||!validFreelanceId(d.actorUid)||[c.requesterUid,c.beneficiaryUid].includes(d.actorUid)||typeof d.reason!=='string'||d.reason.trim()!==d.reason||d.reason.length<10||d.reason.length>1000||d.decidedAt!==r.resolvedAt||d.bankVerified!==false||!audit.exists||audit.get('actorId')!==d.actorUid||audit.get('targetId')!==c.offerId||audit.get('paymentId')!==r.paymentId||audit.get('sourceDigest')!==r.sourceDigest||audit.get('recognizedMinor')!==d.recognizedMinor||audit.get('reasonHash')!==createHash('sha256').update(d.reason).digest('hex')||audit.get('bankVerified')!==false)return fail();
   recognitions.push({paymentId:r.paymentId,recognizedMinor:d.recognizedMinor});
  }
 }
 projectHourlyAdvances(c,events,null,recognitions);
 return {ref,reviews,recognitions};
}
