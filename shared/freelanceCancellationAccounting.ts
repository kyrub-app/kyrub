import type {FreelancePaymentObligation} from './freelancePaymentObligation.js';
import {projectExternalPixStatements,type ExternalPixEvent} from './freelanceExternalPaymentStatements.js';

/** Proposed reconciliation only; neither a bank settlement nor an enforceable balance. */
export function calculateCancellationAccounting(obligation:FreelancePaymentObligation,events:readonly ExternalPixEvent[],recognizedServiceMinor:unknown,reportedReceivedMinor:unknown){
 const fail=():never=>{throw Error('FREELANCE_CANCELLATION_ACCOUNTING_CONFLICT');};
 const agreedMinor=obligation.terms.amountMinor;
 const valid=(v:unknown):v is number=>typeof v==='number'&&Number.isSafeInteger(v)&&v>=0&&v<=agreedMinor;
 if(!Number.isSafeInteger(agreedMinor)||agreedMinor<=0||agreedMinor>999999999||!valid(recognizedServiceMinor)||!valid(reportedReceivedMinor))return fail();
 const {state}=projectExternalPixStatements(obligation,events);
 // A unilateral assertion is not evidence of the amount received. Resolve it
 // using the existing declaration/review process before bilateral accounting.
 if(!['awaiting_payment','nonreceipt_reported','bilaterally_reported_received'].includes(state))return fail();
 // Existing statements describe the entire immutable obligation, not partial
 // transfers. A bilateral receipt must agree with the original amount.
 if(state==='bilaterally_reported_received'&&reportedReceivedMinor!==agreedMinor)return fail();
 if(state==='nonreceipt_reported'&&reportedReceivedMinor!==0)return fail();
 const difference=recognizedServiceMinor-reportedReceivedMinor;
 return {currency:'BRL' as const,agreedMinor,recognizedServiceMinor,reportedReceivedMinor,
  proposedAdditionalMinor:Math.max(0,difference),proposedRefundMinor:Math.max(0,-difference),
  bankVerified:false as const,settlement:'not_verified' as const,responsibility:'not_determined' as const};
}
