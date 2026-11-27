import {validFreelanceId,readFreelancePaymentTerms,sameFreelancePaymentTerms,type FreelanceOffer,type FreelanceApplication} from './freelanceLifecycle.js';
import type {DirectPaymentTerms} from './directPaymentTerms.js';

/** Immutable contract basis, not a wallet balance, settlement or escrow. */
export type FreelancePaymentObligation={
 schemaVersion:1;offerId:string;requesterUid:string;beneficiaryUid:string;
 terms:DirectPaymentTerms;contractedAt:string;
 dueTrigger:'contract_confirmation'|'bilateral_service_completion';
 custody:'none';
};
const conflict=():never=>{throw Error('FREELANCE_PAYMENT_OBLIGATION_CONFLICT');};
export function buildFreelancePaymentObligation(offer:FreelanceOffer,app:FreelanceApplication):FreelancePaymentObligation{
 if(!validFreelanceId(offer.id)||!validFreelanceId(offer.ownerUid)||!validFreelanceId(app.applicantUid)||
 offer.ownerUid===app.applicantUid||offer.selectedApplicantUid!==app.applicantUid||app.offerId!==offer.id||app.ownerUid!==offer.ownerUid||
 offer.status!=='contracted'||app.status!=='contracted'||!offer.selectedAt||offer.selectedAt!==app.selectedAt||
 !offer.contractedAt||offer.contractedAt!==app.contractedAt||!Number.isFinite(Date.parse(offer.selectedAt))||
 !Number.isFinite(Date.parse(offer.contractedAt))||Date.parse(offer.contractedAt)<Date.parse(offer.selectedAt)||
 !Number.isSafeInteger(offer.paymentMinor)||offer.paymentMinor<=0||offer.paymentMinor>999999999||
 offer.occurrenceId||app.occurrenceId||offer.startedAt||app.startedAt||offer.completedAt||app.completedAt||
 offer.completionRequestedAt||app.completionRequestedAt||offer.cancelledAt||app.cancelledAt||
 !sameFreelancePaymentTerms(offer.paymentTerms,app.paymentTerms,offer.paymentMinor))return conflict();
 const terms=readFreelancePaymentTerms(offer.paymentTerms,offer.paymentMinor);
 if(!terms)return conflict();
 return {schemaVersion:1,offerId:offer.id,requesterUid:offer.ownerUid,beneficiaryUid:app.applicantUid,
 terms,contractedAt:offer.contractedAt,dueTrigger:terms.timing==='advance'?'contract_confirmation':'bilateral_service_completion',custody:'none'};
}
export function matchesFreelancePaymentObligation(saved:unknown,expected:FreelancePaymentObligation):boolean{
 if(!saved||typeof saved!=='object'||Array.isArray(saved))return false;
 const r=saved as Record<string,unknown>;
 const keys=Object.keys(expected) as Array<keyof FreelancePaymentObligation>;
 return Object.keys(r).length===keys.length&&keys.every(k=>k==='terms'
 ?sameFreelancePaymentTerms(r.terms,expected.terms,expected.terms.amountMinor):r[k]===expected[k]);
}
