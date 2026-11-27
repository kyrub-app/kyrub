import type {Transaction} from 'firebase-admin/firestore';
import {adminDb} from '../firebaseAdmin.js';
import {readHourlyAdvanceContext} from './freelanceHourlyAdvanceService.js';
import {readHourlyCancellationAgreementContext} from './freelanceHourlyCancellationAgreementService.js';
import {readHourlyExcessContext} from './freelanceHourlyExcessReviewService.js';
import {buildFinal} from './freelanceHourlyFinalObligationService.js';
import {readVariablePaymentSources,canonicalVariablePaymentRecord,digestVariablePaymentSources} from './freelanceVariablePaymentBasisService.js';
import {projectHourlyAdvances} from '../../shared/freelanceHourlyReconciliation.js';

const fail=():never=>{throw Error('FREELANCE_HOURLY_RECONCILIATION_CONFLICT');};
type Basis={kind:'completion'|'cancellation'|'excess';sourceDigest:string;recognizedMinor:number;resolvedAt:string};
/** The gross service amount is always reconstructed from authoritative records,
 * never from an estimate, the participant's payload or the payment history. */
async function readBasis(tx:Transaction,uid:string,id:string,x:Awaited<ReturnType<typeof readHourlyAdvanceContext>>):Promise<Basis|null>{
 if(x.c.offer.status==='cancelled'){
  const c=await readHourlyCancellationAgreementContext(tx,uid,id),r=c.resolved?.resolution;
  return r?{kind:'cancellation',sourceDigest:r.sourceDigest,recognizedMinor:r.recognizedServiceMinor,resolvedAt:r.resolvedAt}:null;
 }
 if(x.c.offer.status!=='completed')return null;
 const s=await readVariablePaymentSources(tx,uid,id);
 if(!s.savedBasis.exists||!s.savedCommitment.exists)return fail();
 if(s.record.disposition==='requires_review'){
  const e=await readHourlyExcessContext(tx,uid,id),r=e.resolved;
  return r?{kind:'excess',sourceDigest:r.sourceDigest,recognizedMinor:r.recognizedServiceMinor,resolvedAt:r.resolvedAt}:null;
 }
 const amount=s.record.finalAmountMinor;
 if(amount===null)return fail();
 const saved=await tx.get(x.c.ref.collection('directPayment').doc('hourlyFinalObligation'));
 if(amount===0?saved.exists:!saved.exists||canonicalVariablePaymentRecord(saved.data())!==canonicalVariablePaymentRecord(buildFinal(s.record)))return fail();
 return {kind:'completion',sourceDigest:s.record.sourceDigest,recognizedMinor:amount,resolvedAt:s.record.completedAt};
}
/** Server-only candidate. The freeze and all source reads share a transaction.
 * No Pix authority, transfers, final statements or bank verification. */
export async function readHourlyReconciliationContext(tx:Transaction,uid:string,id:string){
 const x=await readHourlyAdvanceContext(tx,uid,id);
 const basis=await readBasis(tx,uid,id,x);
 const projection=projectHourlyAdvances(x.commitment,x.events,basis?.recognizedMinor??null,x.review.recognitions);
 const historyDigest=digestVariablePaymentSources(x.review.reviews.length?{events:x.events,reviews:x.review.reviews}:x.events);
 const ready=!!basis&&x.events.length>0&&!projection.pendingCount&&!projection.disputedCount;
 const candidate=ready?{schemaVersion:1 as const,kind:'hourly_reconciliation' as const,offerId:id,commitmentDigest:x.commitmentDigest,
  basis:basis!,historyDigest,revision:x.events.length,reportedPaidMinor:projection.reportedPaidMinor,
  bilateralMinor:projection.bilateralMinor,...(x.review.recognitions.length?{administrativelyRecognizedMinor:projection.administrativelyRecognizedMinor,creditedMinor:projection.creditedMinor}:{}),adjustment:projection.adjustment,currency:'BRL' as const,custody:'none' as const,bankVerified:false as const}:null;
 const saved=x.frozen.data();
 if(saved&&(!candidate||canonicalVariablePaymentRecord(saved)!==canonicalVariablePaymentRecord(candidate)))return fail();
 return {x,basis,projection,historyDigest,candidate,frozen:!!saved};
}
function view(x:Awaited<ReturnType<typeof readHourlyReconciliationContext>>){
 const a=x.projection.adjustment;
 return {offerId:x.x.commitment.offerId,role:x.x.c.actor,revision:x.x.events.length,historyDigest:x.historyDigest,
  sourceDigest:x.basis?.sourceDigest??null,basisKind:x.basis?.kind??null,recognizedMinor:x.projection.recognizedMinor,
  reportedPaidMinor:x.projection.reportedPaidMinor,reportedReceivedMinor:x.projection.reportedReceivedMinor,bilateralMinor:x.projection.bilateralMinor,administrativelyRecognizedMinor:x.projection.administrativelyRecognizedMinor,creditedMinor:x.projection.creditedMinor,
  pendingCount:x.projection.pendingCount,disputedCount:x.projection.disputedCount,state:x.projection.state,
  adjustment:a?{direction:a.direction,amountMinor:a.amountMinor,flow:(x.x.c.actor==='requester')===(a.direction==='additional')?'outflow':'inflow'}:null,
  eligible:!!x.candidate,frozen:x.frozen,restrictionActive:x.x.restricted,bankVerified:false as const};
}
export async function readHourlyReconciliation(uid:string,id:string){
 return adminDb.runTransaction(async tx=>view(await readHourlyReconciliationContext(tx,uid,id)),{readOnly:true});
}
export async function freezeHourlyReconciliation(uid:string,id:string,input:unknown){
 if(!input||typeof input!=='object'||Array.isArray(input))throw Error('FREELANCE_INVALID');
 const b=input as Record<string,unknown>;
 if(Object.keys(b).length!==4||b.confirmed!==true||!Number.isSafeInteger(b.expectedRevision)||Number(b.expectedRevision)<1||
 typeof b.sourceDigest!=='string'||!/^[a-f0-9]{64}$/.test(b.sourceDigest)||typeof b.historyDigest!=='string'||!/^[a-f0-9]{64}$/.test(b.historyDigest))throw Error('FREELANCE_INVALID');
 return adminDb.runTransaction(async tx=>{
  const x=await readHourlyReconciliationContext(tx,uid,id);
  if(!x.candidate||b.expectedRevision!==x.x.events.length||b.historyDigest!==x.historyDigest||b.sourceDigest!==x.basis?.sourceDigest)return fail();
  if(!x.frozen)tx.create(x.x.frozen.ref,x.candidate);
  return {...view(x),frozen:true,changed:!x.frozen};
 });
}
