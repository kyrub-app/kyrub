import {validFreelanceId} from './freelanceLifecycle.js';
import type {FreelanceHourlyCommitment} from './freelanceVariablePaymentBasis.js';

const MAX_MINOR=999999999;
const fail=():never=>{throw Error('FREELANCE_HOURLY_RECONCILIATION_CONFLICT');};
const amount=(v:unknown):v is number=>typeof v==='number'&&Number.isSafeInteger(v)&&v>=0&&v<=MAX_MINOR;
const iso=(v:unknown):v is string=>typeof v==='string'&&Number.isFinite(Date.parse(v))&&new Date(Date.parse(v)).toISOString()===v;
export type HourlyAdvanceEvent={id:string;paymentId:string;actorUid:string;statement:'paid'|'received'|'not_received';amountMinor:number;recordedAt:string};
export type HourlyAdvanceRecognition={paymentId:string;recognizedMinor:number};
type Entry={paid:number|null;received:number|null;denied:boolean};
/** Pure candidate only. A paymentId identifies a single jointly identified
 * external payment; it is NOT a bank transaction ID or evidence of settlement.
 * Persistence must bind this history to the immutable contract and freeze it
 * atomically before final settlement becomes available. */
export function projectHourlyAdvances(c:FreelanceHourlyCommitment,events:readonly HourlyAdvanceEvent[],recognizedMinor:number|null,recognitions:readonly HourlyAdvanceRecognition[]=[]){
 if(c.kind!=='hourly_commitment'||c.paymentMethod!=='external_pix'||c.currency!=='BRL'||c.custody!=='none'||!validFreelanceId(c.offerId)||!validFreelanceId(c.requesterUid)||!validFreelanceId(c.beneficiaryUid)||c.requesterUid===c.beneficiaryUid||!iso(c.contractedAt)||!Array.isArray(events)||events.length>300||(recognizedMinor!==null&&!amount(recognizedMinor)))return fail();
 const ids=new Set<string>(),entries=new Map<string,Entry>();
 let prior=Date.parse(c.contractedAt);
 for(const e of events){
  if(!e||Object.keys(e).length!==6||!validFreelanceId(e.id)||ids.has(e.id)||!validFreelanceId(e.paymentId)||!iso(e.recordedAt)||Date.parse(e.recordedAt)<prior||!amount(e.amountMinor)||e.amountMinor===0)return fail();
  prior=Date.parse(e.recordedAt);ids.add(e.id);
  const x=entries.get(e.paymentId)??{paid:null,received:null,denied:false};
  if(e.statement==='paid'){
   if(e.actorUid!==c.requesterUid||x.paid!==null)return fail();
   x.paid=e.amountMinor;
  }else if(e.statement==='received'){
   if(e.actorUid!==c.beneficiaryUid||x.received!==null)return fail();
   x.received=e.amountMinor;
  }else if(e.statement==='not_received'){
   if(e.actorUid!==c.beneficiaryUid||x.denied||x.received!==null||x.paid===null||x.paid!==e.amountMinor)return fail();
   x.denied=true;
  }else return fail();
  entries.set(e.paymentId,x);
  if(entries.size>100)return fail();
 }
 if(!Array.isArray(recognitions)||recognitions.length>100)return fail();
 const accepted=new Map<string,number>();
 for(const r of recognitions){
  const e=entries.get(r?.paymentId);
  if(!r||Object.keys(r).length!==2||!e||e.paid===null||e.paid===e.received||(!e.denied&&e.received===null)||!amount(r.recognizedMinor)||r.recognizedMinor>Math.max(e.paid,e.received??0)||accepted.has(r.paymentId))return fail();
  accepted.set(r.paymentId,r.recognizedMinor);
 }
 let reportedPaidMinor=0,reportedReceivedMinor=0,bilateralMinor=0,administrativelyRecognizedMinor=0,pendingCount=0,disputedCount=0;
 const disputedPaymentIds:string[]=[];
 for(const [paymentId,x] of entries){
  reportedPaidMinor+=x.paid??0;reportedReceivedMinor+=x.received??0;
  if(x.paid!==null&&x.paid===x.received)bilateralMinor+=x.paid;
  else if(accepted.has(paymentId))administrativelyRecognizedMinor+=accepted.get(paymentId)!;
  else if(x.paid!==null&&(x.denied||x.received!==null)){disputedCount++;disputedPaymentIds.push(paymentId);}
  else pendingCount++;
 }
 const creditedMinor=bilateralMinor+administrativelyRecognizedMinor;
 if(![reportedPaidMinor,reportedReceivedMinor,bilateralMinor,administrativelyRecognizedMinor,creditedMinor].every(amount))return fail();
 const ready=recognizedMinor!==null&&pendingCount===0&&disputedCount===0;
 const delta=ready?recognizedMinor!-creditedMinor:null;
 return {reportedPaidMinor,reportedReceivedMinor,bilateralMinor,administrativelyRecognizedMinor,creditedMinor,disputedPaymentIds,pendingCount,disputedCount,recognizedMinor,
  state:disputedCount?'disputed' as const:pendingCount?'awaiting_confirmation' as const:recognizedMinor===null?'awaiting_accounting' as const:delta===0?'no_adjustment' as const:delta!>0?'additional_due' as const:'refund_due' as const,
  adjustment:delta===null||delta===0?null:{direction:delta>0?'additional' as const:'refund' as const,amountMinor:Math.abs(delta),payerUid:delta>0?c.requesterUid:c.beneficiaryUid,recipientUid:delta>0?c.beneficiaryUid:c.requesterUid},
  bankVerified:false as const};
}
export function appendHourlyAdvance(c:FreelanceHourlyCommitment,events:readonly HourlyAdvanceEvent[],event:HourlyAdvanceEvent,recognitions:readonly HourlyAdvanceRecognition[]=[]){
 projectHourlyAdvances(c,events,null,recognitions);
 if(!event||Object.keys(event).length!==6||!iso(event.recordedAt))return fail();
 const prior=events.find(e=>e.id===event.id);
 if(prior){
  if(prior.paymentId!==event.paymentId||prior.actorUid!==event.actorUid||prior.statement!==event.statement||prior.amountMinor!==event.amountMinor)return fail();
  return {changed:false,events:[...events],...projectHourlyAdvances(c,events,null,recognitions)};
 }
 const next=[...events,event];
 return {changed:true,events:next,...projectHourlyAdvances(c,next,null,recognitions)};
}
