import {validFreelanceId,normalizeFreelanceOffer} from '../../shared/freelanceLifecycle.js';
import {assertProductionPilot,assertProductionPrecontractTerms} from './freelanceProductionPolicy.js';
import * as lifecycle from './freelanceLifecycleService.js';
/** Explicitly excludes confirmation, execution, payment and reputation writes. */
export async function executeProductionPrecontractAction(uid:string,input:unknown){
 assertProductionPilot(uid,true);
 if(!input||typeof input!=='object'||Array.isArray(input))throw Error('FREELANCE_INVALID');
 const b=input as Record<string,unknown>;
 if(!validFreelanceId(b.offerId))throw Error('FREELANCE_INVALID');
 const exact=(fields:string[])=>{if(Object.keys(b).some(k=>!['action','offerId',...fields].includes(k)))throw Error('FREELANCE_INVALID');};
 switch(b.action){
 case 'publish':{
  exact(['terms','requesterStoreId']);const terms=normalizeFreelanceOffer(b.terms);assertProductionPrecontractTerms(terms);
  return lifecycle.publishFreelanceOffer(uid,b.offerId,terms,b.requesterStoreId,true);
 }
 case 'apply':exact(['expectedPaymentTerms','expectedWorkTerms','counterproposal','expectedRequesterStore']);return lifecycle.applyToFreelanceOffer(uid,b.offerId,{expected:b.expectedPaymentTerms,expectedWorkTerms:b.expectedWorkTerms,expectedRequesterStore:b.expectedRequesterStore,counterproposal:b.counterproposal},true);
 case 'select':exact(['applicantUid','expectedCounterproposal']);if(!validFreelanceId(b.applicantUid))throw Error('FREELANCE_INVALID');return lifecycle.selectFreelanceApplication(uid,b.offerId,b.applicantUid,b.expectedCounterproposal,true);
 case 'release':exact(['applicantUid','confirmed']);if(!validFreelanceId(b.applicantUid))throw Error('FREELANCE_INVALID');return lifecycle.releaseFreelanceReservation(uid,b.offerId,b.applicantUid,b.confirmed);
 case 'withdraw':exact(['confirmed']);return lifecycle.withdrawPendingFreelanceApplication(uid,b.offerId,b.confirmed);
 case 'cancel_open':exact(['confirmed']);return lifecycle.cancelUncontractedFreelanceOffer(uid,b.offerId,b.confirmed);
 default:throw Error('FREELANCE_INVALID');
 }
}
