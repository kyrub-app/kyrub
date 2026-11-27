import {adminDb} from '../firebaseAdmin.js';
import {assertFreelanceReputationLocal,readFreelanceReputationContext} from './freelanceReputationService.js';
import {digestVariablePaymentSources,canonicalVariablePaymentRecord} from './freelanceVariablePaymentBasisService.js';
import {emptyReputationAccumulator,validateReputationAccumulator,incrementReputationExperience,incrementReleasedReputation} from '../../shared/freelanceReputationAccumulator.js';
const fail=():never=>{throw Error('FREELANCE_REPUTATION_INDEX_CONFLICT');};
const equal=(a:unknown,b:unknown)=>canonicalVariablePaymentRecord(a)===canonicalVariablePaymentRecord(b);
/** Candidate internal repair/reconciliation, not an HTTP route. A single
 * canonical contract contributes experience once and released scores once.
 * Corporate scope includes historical representative, not a transfer policy.
 * No index is declared complete by observing a subset of contracts. */
export async function reconcileFreelanceReputationIndex(uid:string,offerId:string){
 assertFreelanceReputationLocal();
 if(process.env.KYRUB_FREELANCE_REPUTATION_INDEX_TEST_ONLY!=='true')throw Error('FREELANCE_FORBIDDEN');
 return adminDb.runTransaction(async tx=>{
  const x=await readFreelanceReputationContext(tx,uid,offerId);
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
  if(addExperience||addRatings){
   for(let i=0;i<refs.length;i++)tx.set(refs[i],plans[i]);
   const record={schemaVersion:1,offerId,contractDigest:x.contractDigest,scopes:scopeIdentity,releaseDigest};
   if(prev)tx.set(receipt,record);else tx.create(receipt,record);
  }
  return {experienceAdded:addExperience,ratingsAdded:addRatings,coverage:'unverified' as const};
 });
}
