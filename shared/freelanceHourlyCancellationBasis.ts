import {buildFreelanceHourlyCommitment} from './freelanceVariablePaymentBasis.js';
import {calculateFreelanceHourlyAccounting,type FreelanceHourlyExtension} from './freelanceHourlyAccounting.js';
import type {FreelanceAttendanceSchedule,FreelanceAttendanceEvent} from './freelanceAttendance.js';
import {validFreelanceId,type FreelanceOffer,type FreelanceApplication,type FreelanceOccurrence} from './freelanceLifecycle.js';
const fail=():never=>{throw Error('FREELANCE_VARIABLE_PAYMENT_CONFLICT');};
const iso=(v:unknown):v is string=>typeof v==='string'&&Number.isFinite(Date.parse(v))&&new Date(Date.parse(v)).toISOString()===v;
export function buildHourlyCancellationBasis(input:{
 offer:FreelanceOffer;application:FreelanceApplication;occurrence:FreelanceOccurrence;
 attendance:null|{scheduleId:string;schedule:FreelanceAttendanceSchedule;scheduleAcceptedAt:string;events:readonly FreelanceAttendanceEvent[];extensions:readonly FreelanceHourlyExtension[]};
}){
 const {offer,application:app,occurrence:o,attendance:t}=input;
 const commitment=buildFreelanceHourlyCommitment(offer,app),d=o.decision;
 if(offer.status!=='cancelled'||offer.occurrenceId||app.occurrenceId||offer.completedAt||app.completedAt||
 !iso(offer.cancelledAt)||offer.cancelledAt!==app.cancelledAt||
 !validFreelanceId(o.id)||o.offerId!==offer.id||o.ownerUid!==offer.ownerUid||o.applicantUid!==app.applicantUid||
 ![o.ownerUid,o.applicantUid].includes(o.openedBy)||o.status!=='resolved'||!d||d.outcome!=='cancel'||d.financialReview!=='pending'||
 !validFreelanceId(d.actorUid)||[o.ownerUid,o.applicantUid].includes(d.actorUid)||d.decidedAt!==offer.cancelledAt||
 !iso(o.openedAt)||Date.parse(o.openedAt)<Date.parse(commitment.contractedAt)||Date.parse(d.decidedAt)<Date.parse(o.openedAt)||
 !['contracted','in_progress','completion_requested'].includes(o.priorStatus))return fail();
 let prior=Date.parse(commitment.contractedAt);
 for(const field of ['startedAt','completionRequestedAt'] as const){
  const required=field==='startedAt'?o.priorStatus!=='contracted':o.priorStatus==='completion_requested';
  const at=offer[field];
  if(required){if(!iso(at)||at!==app[field]||Date.parse(at)<prior||Date.parse(at)>Date.parse(o.openedAt))return fail();prior=Date.parse(at);}
  else if(at!==undefined||app[field]!==undefined)return fail();
 }
 if(!t&&o.priorStatus!=='contracted')return fail();
 let accounting=null;
 if(t){
  if(!validFreelanceId(t.scheduleId)||!iso(t.scheduleAcceptedAt)||Date.parse(t.scheduleAcceptedAt)<Date.parse(commitment.contractedAt)||
   Date.parse(t.scheduleAcceptedAt)>=Date.parse(t.schedule.scheduledStartAt)||t.events.some(e=>Date.parse(e.at)<Date.parse(t.scheduleAcceptedAt)))return fail();
  const last=t.events.at(-1);
  if(last?.kind!=='suspend'||last.actor!=='system'||last.at!==o.openedAt)return fail();
  for(const [kind,at] of [['start',offer.startedAt],['checkout',offer.completionRequestedAt]] as const){
   const found=t.events.filter(e=>e.kind===kind);
   if(at===undefined?found.length!==0:found.length!==1||found[0].at!==at)return fail();
  }
  accounting=calculateFreelanceHourlyAccounting({workTerms:offer.workTerms,estimatedMinor:offer.paymentMinor,schedule:t.schedule,events:t.events,extensions:t.extensions});
  if(accounting.status!=='requires_suspension_review')return fail();
 }
 return {schemaVersion:1 as const,kind:'hourly_cancellation_basis' as const,commitment,occurrenceId:o.id,cancelledAt:offer.cancelledAt,
  suspendedAt:o.openedAt,scheduleId:t?.scheduleId??null,accounting,recognizedServiceMinor:null,finalAmountMinor:null,
  disposition:'requires_review' as const,payable:false as const,responsibility:'not_determined' as const,bankVerified:false as const,settlement:'not_verified' as const};
}
