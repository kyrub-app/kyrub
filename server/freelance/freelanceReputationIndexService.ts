import {adminDb} from '../firebaseAdmin.js';
import {assertFreelanceReputationLocal,readFreelanceReputationContext} from './freelanceReputationService.js';
import {prepareFreelanceReputationIndex,reputationIndexEnabled} from './freelanceReputationIndexPreparation.js';
/** Internal isolated repair; coverage remains unverified. */
export async function reconcileFreelanceReputationIndex(uid:string,offerId:string){
 assertFreelanceReputationLocal();
 if(!reputationIndexEnabled())throw Error('FREELANCE_FORBIDDEN');
 return adminDb.runTransaction(async tx=>{
  const x=await readFreelanceReputationContext(tx,uid,offerId);
  const {write,...result}=await prepareFreelanceReputationIndex(tx,x);
  write();return result;
 });
}
