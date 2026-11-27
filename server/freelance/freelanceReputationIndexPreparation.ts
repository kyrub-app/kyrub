import type {Transaction} from 'firebase-admin/firestore';
import {adminDb,getFirebaseAdminProjectId} from '../firebaseAdmin.js';
import {digestVariablePaymentSources,canonicalVariablePaymentRecord} from './freelanceVariablePaymentBasisService.js';
import {emptyReputationAccumulator,validateReputationAccumulator,incrementReputationExperience,incrementReleasedReputation} from '../../shared/freelanceReputationAccumulator.js';
import {freelanceReputationParties,type ReputationSubject} from '../../shared/freelanceReputation.js';
import type {FreelanceOffer,FreelanceApplication} from '../../shared/freelanceLifecycle.js';
import type {ReputationScores} from '../../shared/freelanceReputationCriteria.js';
type Slot={schemaVersion:2;offerId:string;contractDigest:string;role:'requester'|'worker';authorUid:string;subject:ReputationSubject;scores:ReputationScores;submittedAt:string};
type Context={parties:ReturnType<typeof freelanceReputationParties>;contractDigest:string;slots:{requester?:Slot;worker?:Slot}};
const fail=():never=>{throw Error('FREELANCE_REPUTATION_INDEX_CONFLICT');};
const equal=(a:unknown,b:unknown)=>canonicalVariablePaymentRecord(a)===canonicalVariablePaymentRecord(b);
export function reputationIndexEnabled(){
 return process.env.KYRUB_FREELANCE_REPUTATION_INDEX_TEST_ONLY==='true'&&process.env.KYRUB_FREELANCE_REPUTATION_TEST_ONLY==='true'&&process.env.KYRUB_FREELANCE_LOCAL_HOMOLOGATION==='true'&&!process.env.VERCEL&&!process.env.VERCEL_ENV&&!process.env.FIREBASE_SERVICE_ACCOUNT_JSON&&!process.env.GOOGLE_APPLICATION_CREDENTIALS&&['127.0.0.1:8088','localhost:8088'].includes(process.env.FIRESTORE_EMULATOR_HOST??'')&&['127.0.0.1:9099','localhost:9099'].includes(process.env.FIREBASE_AUTH_EMULATOR_HOST??'')&&getFirebaseAdminProjectId()==='kyrub-security-test';
}
export function reputationContractContext(offer:FreelanceOffer,application:FreelanceApplication){
 const parties=freelanceReputationParties(offer,application);
 const contractDigest=digestVariablePaymentSources({parties,selectedAt:offer.selectedAt,contractedAt:offer.contractedAt,startedAt:offer.startedAt,completionRequestedAt:offer.completionRequestedAt,paymentMinor:offer.paymentMinor,paymentTerms:offer.paymentTerms??null,workTerms:offer.workTerms??null,requesterStore:offer.requesterStore??null});
 return {parties,contractDigest};
}
/** Prepare all reads before any write in the enclosing transaction. */
export async function prepareFreelanceReputationIndex(tx:Transaction,x:Context){
 if(!reputationIndexEnabled())throw Error('FREELANCE_FORBIDDEN');
 const offerId=x.parties.offerId;
  const released=!!x.slots.worker&&!!x.slots.requester;
  const receipt=adminDb.doc('freelanceReputationIndexReceiptsV1/'+offerId);
  const scopes=[{subject:x.parties.worker,representativeUid:x.parties.workerUid,rating:x.slots.requester},{subject:x.parties.requester,representativeUid:x.parties.requesterUid,rating:x.slots.worker}];
  const refs=scopes.map(s=>adminDb.doc('freelanceReputationIndexesV1/'+digestVariablePaymentSources({subject:s.subject,representativeUid:s.representativeUid})));
  const [prior,...snapshots]=await tx.getAll(receipt,...refs);
  const prev=prior.data();
  const scopeIdentity=scopes.map(s=>({subject:s.subject,representativeUid:s.representativeUid}));
  const releaseDigest=released?digestVariablePaymentSources([x.slots.requester,x.slots.worker]):null;
  if(prev&&(Object.keys(prev).length!==5||prev.schemaVersion!==1||prev.offerId!==offerId||prev.contractDigest!==x.contractDigest||!equal(prev.scopes,scopeIdentity)||!(prev.releaseDigest===null||typeof prev.releaseDigest==='string'&&/^[a-f0-9]{64}$/.test(prev.releaseDigest))||prev.releaseDigest!==null&&prev.releaseDigest!==releaseDigest))return fail();
  const addExperience=!prev,addRatings=released&&(!prev||prev.releaseDigest===null);
  const plans=scopes.map((s,i)=>{
   const raw=snapshots[i].data();
   if((prev&&!raw)||raw&&(Object.keys(raw).length!==4||raw.schemaVersion!==1||!equal(raw.subject,s.subject)||raw.representativeUid!==s.representativeUid))return fail();
   let accumulator=raw?validateReputationAccumulator(s.subject.kind,raw.accumulator):emptyReputationAccumulator(s.subject.kind);
   if(addExperience)accumulator=incrementReputationExperience(s.subject.kind,accumulator);
   if(addRatings)accumulator=incrementReleasedReputation(s.subject.kind,accumulator,s.rating!.scores);
   return {schemaVersion:1,subject:s.subject,representativeUid:s.representativeUid,accumulator};
  });
  const write=()=>{
  if(addExperience||addRatings){
   for(let i=0;i<refs.length;i++)tx.set(refs[i],plans[i]);
   const record={schemaVersion:1,offerId,contractDigest:x.contractDigest,scopes:scopeIdentity,releaseDigest};
   if(prev)tx.set(receipt,record);else tx.create(receipt,record);
  }
  };
  return {write,experienceAdded:addExperience,ratingsAdded:addRatings,coverage:'unverified' as const};

}
