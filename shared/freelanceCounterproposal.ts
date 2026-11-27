import {createDirectPaymentTerms} from './directPaymentTerms.js';
import {readFreelanceWorkTerms} from './freelanceWorkTerms.js';
import type {FreelanceOfferInput} from './freelanceLifecycle.js';

export type FreelanceCounterproposal={amountMinor:number;estimatedMinutes:number};
export type FreelanceOriginalTerms=Pick<FreelanceOfferInput,'paymentMinor'|'paymentTerms'|'workTerms'>;
const invalid=():never=>{throw Error('FREELANCE_INVALID');};
/** One immutable counterproposal per application, restricted to price and estimated duration. */
export function readFreelanceCounterproposal(value:unknown,offer:FreelanceOriginalTerms):FreelanceCounterproposal|undefined{
 if(value===undefined)return undefined;
 if(!value||typeof value!=='object'||Array.isArray(value)||Object.keys(value).length!==2||
  offer.workTerms?.mode!=='fixed'||offer.paymentTerms?.method!=='external_pix')return invalid();
 const v=value as Record<string,unknown>;
 if(typeof v.amountMinor!=='number'||!Number.isSafeInteger(v.amountMinor)||v.amountMinor<1||v.amountMinor>999999999||
  typeof v.estimatedMinutes!=='number'||!Number.isSafeInteger(v.estimatedMinutes)||
  (v.amountMinor===offer.paymentMinor&&v.estimatedMinutes===offer.workTerms.estimatedMinutes))return invalid();
 readFreelanceWorkTerms({...offer.workTerms,estimatedMinutes:v.estimatedMinutes},v.amountMinor);
 return {amountMinor:v.amountMinor,estimatedMinutes:v.estimatedMinutes};
}
export function sameFreelanceCounterproposal(a:unknown,b:unknown,offer:FreelanceOriginalTerms){
 try{return JSON.stringify(readFreelanceCounterproposal(a,offer))===JSON.stringify(readFreelanceCounterproposal(b,offer));}catch{return false;}
}
export function negotiatedFreelanceTerms(offer:FreelanceOriginalTerms,proposal:unknown):FreelanceOriginalTerms{
 const p=readFreelanceCounterproposal(proposal,offer);
 if(!p)return {paymentMinor:offer.paymentMinor,...(offer.paymentTerms?{paymentTerms:offer.paymentTerms}:{}),...(offer.workTerms?{workTerms:offer.workTerms}:{})};
 return {paymentMinor:p.amountMinor,paymentTerms:createDirectPaymentTerms({method:'external_pix',timing:offer.paymentTerms!.timing,amountMinor:p.amountMinor}),
 workTerms:readFreelanceWorkTerms({...offer.workTerms!,estimatedMinutes:p.estimatedMinutes},p.amountMinor)!};
}
