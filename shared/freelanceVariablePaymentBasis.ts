import {validFreelanceId,readFreelancePaymentTerms,sameFreelancePaymentTerms,type FreelanceOffer,type FreelanceApplication} from './freelanceLifecycle.js';
import {readFreelanceWorkTerms,sameFreelanceWorkTerms} from './freelanceWorkTerms.js';
import {readFreelanceStoreRepresentation,sameFreelanceStoreRepresentation} from './freelanceStoreRepresentation.js';
import {calculateFreelanceHourlyAccounting,type FreelanceHourlyExtension} from './freelanceHourlyAccounting.js';
import type {FreelanceAttendanceEvent,FreelanceAttendanceSchedule} from './freelanceAttendance.js';

const fail=():never=>{throw Error('FREELANCE_VARIABLE_PAYMENT_CONFLICT');};
const iso=(v:unknown):v is string=>typeof v==='string'&&Number.isFinite(Date.parse(v))&&new Date(Date.parse(v)).toISOString()===v;
export function buildFreelanceHourlyCommitment(offer:FreelanceOffer,app:FreelanceApplication){
 const terms=readFreelanceWorkTerms(offer.workTerms,offer.paymentMinor);
 const payment=readFreelancePaymentTerms(offer.paymentTerms,offer.paymentMinor);
 if(terms?.mode!=='hourly'||payment?.method!=='external_pix'||payment.timing!=='on_completion'||
 !validFreelanceId(offer.id)||!validFreelanceId(offer.ownerUid)||!validFreelanceId(app.applicantUid)||offer.ownerUid===app.applicantUid||
 offer.selectedApplicantUid!==app.applicantUid||app.offerId!==offer.id||app.ownerUid!==offer.ownerUid||
 offer.status!==app.status||!['contracted','in_progress','completion_requested','completed','under_review','cancelled'].includes(offer.status)||
 !iso(offer.selectedAt)||offer.selectedAt!==app.selectedAt||!iso(offer.contractedAt)||offer.contractedAt!==app.contractedAt||
 Date.parse(offer.selectedAt)>Date.parse(offer.contractedAt)||offer.originalOfferTerms||offer.selectedCounterproposal||app.counterproposal||
 !sameFreelanceWorkTerms(offer.workTerms,app.workTerms,offer.paymentMinor)||!sameFreelancePaymentTerms(offer.paymentTerms,app.paymentTerms,offer.paymentMinor)||
 !sameFreelanceStoreRepresentation(offer.requesterStore,app.requesterStore))return fail();
 const store=readFreelanceStoreRepresentation(offer.requesterStore);
 return {schemaVersion:1 as const,kind:'hourly_commitment' as const,offerId:offer.id,requesterUid:offer.ownerUid,beneficiaryUid:app.applicantUid,
 ...(store?{requesterStoreId:store.storeId}:{}),contractedAt:offer.contractedAt,currency:'BRL' as const,
 estimatedMinor:offer.paymentMinor,hourlyRateMinor:terms.hourlyRateMinor,initialMinutes:terms.estimatedMinutes,location:terms.location,
 paymentMethod:'external_pix' as const,paymentTiming:'on_completion' as const,custody:'none' as const};
}
export type FreelanceHourlyCommitment=ReturnType<typeof buildFreelanceHourlyCommitment>;
/** A final basis is a calculation candidate, never a Pix command or proof.
 * Existing fixed-price obligations must not be reused for this record. */
export function buildFreelanceVariablePaymentBasis(input:{
 offer:FreelanceOffer;application:FreelanceApplication;scheduleId:string;schedule:FreelanceAttendanceSchedule;
 scheduleAcceptedAt:string;events:readonly FreelanceAttendanceEvent[];extensions:readonly FreelanceHourlyExtension[];
}){
 const {offer,application:app,schedule,events,extensions}=input;
 const commitment=buildFreelanceHourlyCommitment(offer,app);
 if(!validFreelanceId(input.scheduleId)||!iso(input.scheduleAcceptedAt)||Date.parse(input.scheduleAcceptedAt)<Date.parse(commitment.contractedAt)||
 Date.parse(input.scheduleAcceptedAt)>=Date.parse(schedule.scheduledStartAt)||
 events.some(e=>Date.parse(e.at)<Date.parse(input.scheduleAcceptedAt)))return fail();
 if(offer.status!=='completed'||offer.occurrenceId||app.occurrenceId||offer.cancelledAt||app.cancelledAt)return fail();
 const fields=['startedAt','completionRequestedAt','completedAt'] as const;
 let prior=Date.parse(input.scheduleAcceptedAt);
 for(const field of fields){const at=offer[field];if(!iso(at)||at!==app[field]||Date.parse(at)<prior)return fail();prior=Date.parse(at);}
 const expected=[['start',offer.startedAt],['checkout',offer.completionRequestedAt],['confirm_checkout',offer.completedAt]] as const;
 for(const [kind,at] of expected){const found=events.filter(e=>e.kind===kind);if(found.length!==1||found[0].at!==at)return fail();}
 if(events.at(-1)?.kind!=='confirm_checkout')return fail();
 const accounting=calculateFreelanceHourlyAccounting({workTerms:offer.workTerms,estimatedMinor:offer.paymentMinor,schedule,events,extensions});
 if(!['calculated','requires_excess_review'].includes(accounting.status))return fail();
 const amount=accounting.calculatedServiceMinor;
 return {schemaVersion:1 as const,kind:'hourly_completion_basis' as const,commitment,scheduleId:input.scheduleId,scheduleAcceptedAt:input.scheduleAcceptedAt,
 completedAt:offer.completedAt!,accounting,finalAmountMinor:amount,
 disposition:amount===null?'requires_review' as const:amount===0?'no_payment_required' as const:'positive_amount_calculated' as const,
 payable:false as const,bankVerified:false as const,settlement:'not_verified' as const};
}
export type FreelanceVariablePaymentBasis=ReturnType<typeof buildFreelanceVariablePaymentBasis>;
