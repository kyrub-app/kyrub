import {validFreelanceId,sameFreelancePaymentTerms,type FreelanceOffer,type FreelanceApplication} from './freelanceLifecycle.js';
import {sameFreelanceStoreRepresentation,readFreelanceStoreRepresentation} from './freelanceStoreRepresentation.js';
import {sameFreelanceWorkTerms} from './freelanceWorkTerms.js';

export type ReputationSubject={kind:'professional'|'personal_requester'|'store_requester';id:string};
const conflict=():never=>{throw Error('FREELANCE_REPUTATION_CONFLICT');};
/** Pure identity/eligibility foundation for confirmed completed contracts only.
 * No rating format, reward, publication deadline, database write or public API.
 * Other terminal outcomes require explicit policy before being admitted. */
export function freelanceReputationParties(offer:FreelanceOffer,application:FreelanceApplication){
 if(!validFreelanceId(offer.id)||!validFreelanceId(offer.ownerUid)||!validFreelanceId(application.applicantUid)||
 offer.ownerUid===application.applicantUid||offer.id!==application.offerId||offer.ownerUid!==application.ownerUid||
 offer.selectedApplicantUid!==application.applicantUid||offer.status!=='completed'||application.status!=='completed'||
 !Number.isSafeInteger(offer.paymentMinor)||offer.paymentMinor<=0||offer.paymentMinor>999999999||
 !sameFreelancePaymentTerms(offer.paymentTerms,application.paymentTerms,offer.paymentMinor)||
 !sameFreelanceWorkTerms(offer.workTerms,application.workTerms,offer.paymentMinor)||
 !sameFreelanceStoreRepresentation(offer.requesterStore,application.requesterStore))return conflict();
 let previous=-Infinity;
 for(const field of ['selectedAt','contractedAt','startedAt','completionRequestedAt','completedAt'] as const){
  const at=offer[field];
  if(typeof at!=='string'||at!==application[field]||!Number.isFinite(Date.parse(at))||Date.parse(at)<previous)return conflict();
  previous=Date.parse(at);
 }
 const store=readFreelanceStoreRepresentation(offer.requesterStore);
 const requester:ReputationSubject=store?{kind:'store_requester',id:store.storeId}:{kind:'personal_requester',id:offer.ownerUid};
 const worker:ReputationSubject={kind:'professional',id:application.applicantUid};
 return {offerId:offer.id,completedAt:offer.completedAt!,requesterUid:offer.ownerUid,workerUid:application.applicantUid,requester,worker};
}
/** The eventual storage key is per contract and participant, not per rating,
 * device or arbitrary client-supplied target. */
export function freelanceReputationSlot(offer:FreelanceOffer,application:FreelanceApplication,actorUid:string){
 const c=freelanceReputationParties(offer,application);
 if(actorUid===c.requesterUid)return {offerId:c.offerId,role:'requester' as const,subject:c.worker,completedAt:c.completedAt};
 if(actorUid===c.workerUid)return {offerId:c.offerId,role:'worker' as const,subject:c.requester,completedAt:c.completedAt};
 throw Error('FREELANCE_FORBIDDEN');
}
