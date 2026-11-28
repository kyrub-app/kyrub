import {validFreelanceId,type FreelanceOffer,type FreelanceApplication,type FreelanceOccurrence} from './freelanceLifecycle.js';

/** Immutable operational basis, not a balance, funding authorization or settlement. */
export interface FreelanceRemunerationBasis {
  schemaVersion:1;
  offerId:string;
  requesterUid:string;
  beneficiaryUid:string;
  currency:'BRL';
  agreedMinor:number;
  confirmedServiceMinor:number|null;
  source:'bilateral_completion'|'administrative_cancellation';
  sourceOccurrenceId:string|null;
  recordedAt:string;
  responsibility:'not_determined';
  settlement:'not_verified';
}
export function buildFreelanceRemunerationBasis(offer:FreelanceOffer,application:FreelanceApplication,occurrence?:FreelanceOccurrence):FreelanceRemunerationBasis{
  const invalid=()=>{throw Error('FREELANCE_FINANCIAL_BASIS_CONFLICT');};
  if(!validFreelanceId(offer.id)||!validFreelanceId(offer.ownerUid)||!validFreelanceId(application.applicantUid)||
    offer.selectedApplicantUid!==application.applicantUid||offer.ownerUid!==application.ownerUid||
    application.offerId!==offer.id||offer.ownerUid===application.applicantUid||offer.status!==application.status||
    !Number.isSafeInteger(offer.paymentMinor)||offer.paymentMinor<=0||offer.paymentMinor>999999999||
    offer.occurrenceId||application.occurrenceId)invalid();
  const fields=['selectedAt','contractedAt','startedAt','completionRequestedAt','completedAt'] as const;
  let prior=Date.parse(offer.createdAt);
  if(!Number.isFinite(prior))invalid();
  for(const field of fields){
    const at=offer[field];
    if(at!==application[field])invalid();
    if(!at){
      if(offer.status==='completed'||field==='selectedAt'||field==='contractedAt')invalid();
      continue;
    }
    if(!Number.isFinite(Date.parse(at))||Date.parse(at)<prior)invalid();
    prior=Date.parse(at);
  }
  const common={schemaVersion:1 as const,offerId:offer.id,requesterUid:offer.ownerUid,beneficiaryUid:application.applicantUid,
    currency:'BRL' as const,agreedMinor:offer.paymentMinor,responsibility:'not_determined' as const,settlement:'not_verified' as const};
  if(offer.status==='completed'&&!occurrence&&!offer.cancelledAt&&!application.cancelledAt){
    return {...common,confirmedServiceMinor:offer.paymentMinor,source:'bilateral_completion',sourceOccurrenceId:null,recordedAt:offer.completedAt!};
  }
  if(offer.status==='cancelled'&&occurrence?.status==='resolved'&&occurrence.decision?.outcome==='cancel'&&
    occurrence.decision.financialReview==='pending'&&validFreelanceId(occurrence.id)&&occurrence.offerId===offer.id&&
    occurrence.ownerUid===offer.ownerUid&&occurrence.applicantUid===application.applicantUid&&
    offer.cancelledAt===application.cancelledAt&&offer.cancelledAt===occurrence.decision.decidedAt&&
    !offer.completedAt&&!application.completedAt&&Number.isFinite(Date.parse(offer.cancelledAt!))&&Date.parse(offer.cancelledAt!)>=prior){
    return {...common,confirmedServiceMinor:null,source:'administrative_cancellation',sourceOccurrenceId:occurrence.id,recordedAt:offer.cancelledAt!};
  }
  throw Error('FREELANCE_FINANCIAL_BASIS_CONFLICT');
}
export function matchesFreelanceRemunerationBasis(saved:unknown,expected:FreelanceRemunerationBasis):boolean{
  if(!saved||typeof saved!=='object'||Array.isArray(saved))return false;
  const data=saved as Record<string,unknown>;
  return Object.keys(data).length===Object.keys(expected).length&&Object.entries(expected).every(([key,value])=>data[key]===value);
}
