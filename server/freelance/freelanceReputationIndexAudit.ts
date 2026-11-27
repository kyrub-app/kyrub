import {FieldPath} from 'firebase-admin/firestore';
import {adminDb} from '../firebaseAdmin.js';
import {readOwnedFreelanceStore} from './freelanceStoreRepresentationService.js';
import {assertFreelanceReputationLocal,readFreelanceReputationContext,REPUTATION_HISTORY_SCAN_LIMIT} from './freelanceReputationService.js';
import {reputationIndexEnabled} from './freelanceReputationIndexPreparation.js';
import {digestVariablePaymentSources,canonicalVariablePaymentRecord} from './freelanceVariablePaymentBasisService.js';
import {emptyReputationAccumulator,incrementReputationExperience,incrementReleasedReputation,validateReputationAccumulator,projectReputationAccumulator} from '../../shared/freelanceReputationAccumulator.js';
import {validFreelanceId,type FreelanceOffer} from '../../shared/freelanceLifecycle.js';
import type {ReputationSubject} from '../../shared/freelanceReputation.js';
const equal=(a:unknown,b:unknown)=>canonicalVariablePaymentRecord(a)===canonicalVariablePaymentRecord(b);
/** Read-only bounded audit. Verifies source records, every contract receipt,
 * and the exact accumulator in the same snapshot. Never creates a durable
 * certificate: an interrupted feature flag or a historical import could
 * invalidate coverage after this transaction. No client endpoint. */
export async function auditOwnFreelanceReputationIndex(uid:string,kind:unknown){
 assertFreelanceReputationLocal();
 if(!reputationIndexEnabled())throw Error('FREELANCE_FORBIDDEN');
 if(!validFreelanceId(uid)||(kind!=='professional'&&kind!=='personal_requester'&&kind!=='store_requester'))throw Error('FREELANCE_INVALID');
 return adminDb.runTransaction(async tx=>{
  const store=kind==='store_requester'?await readOwnedFreelanceStore(tx,uid):null;
  if(kind==='store_requester'&&!store)throw Error('FREELANCE_STORE_FORBIDDEN');
  const subject:ReputationSubject={kind,id:store?.storeId??uid};
  const docs=await tx.get(adminDb.collection('freelanceOffersV1').where(kind==='professional'?'selectedApplicantUid':'ownerUid','==',uid)
   .where('status','==','completed').orderBy(FieldPath.documentId()).limit(REPUTATION_HISTORY_SCAN_LIMIT+1));
  if(docs.size>REPUTATION_HISTORY_SCAN_LIMIT)return {subject,state:'requires_batched_audit' as const,missingReceipts:null,staleReceipts:null,projection:null};
  let expected=emptyReputationAccumulator(kind),missingReceipts=0,staleReceipts=0;
  for(const doc of docs.docs){
   const o=doc.data() as FreelanceOffer;
   if(o.id!==doc.id||o.status!=='completed'||!validFreelanceId(o.ownerUid)||(kind==='professional'?o.selectedApplicantUid!==uid||o.ownerUid===uid:o.ownerUid!==uid))throw Error('FREELANCE_REPUTATION_INDEX_CONFLICT');
   if(kind==='personal_requester'&&o.requesterStore!==undefined)continue;
   if(kind==='store_requester'&&o.requesterStore?.storeId!==store?.storeId)continue;
   const x=await readFreelanceReputationContext(tx,uid,doc.id);
   const actual=kind==='professional'?x.parties.worker:x.parties.requester;
   if(!equal(subject,actual))throw Error('FREELANCE_REPUTATION_INDEX_CONFLICT');
   expected=incrementReputationExperience(kind,expected);
   const releaseDigest=x.slots.worker&&x.slots.requester?digestVariablePaymentSources([x.slots.requester,x.slots.worker]):null;
   if(releaseDigest)expected=incrementReleasedReputation(kind,expected,(kind==='professional'?x.slots.requester:x.slots.worker)!.scores);
   const receipt=(await tx.get(adminDb.doc('freelanceReputationIndexReceiptsV1/'+doc.id))).data();
   const scopes=[{subject:x.parties.worker,representativeUid:x.parties.workerUid},{subject:x.parties.requester,representativeUid:x.parties.requesterUid}];
   if(!receipt){missingReceipts++;continue;}
   if(!equal(receipt,{schemaVersion:1,offerId:doc.id,contractDigest:x.contractDigest,scopes,releaseDigest}))staleReceipts++;
  }
  const raw=(await tx.get(adminDb.doc('freelanceReputationIndexesV1/'+digestVariablePaymentSources({subject,representativeUid:uid})))).data();
  let matches=false;
  if(!raw)matches=expected.completedContracts===0;
  else if(Object.keys(raw).length===4&&raw.schemaVersion===1&&raw.representativeUid===uid&&equal(raw.subject,subject)){
   try{matches=equal(validateReputationAccumulator(kind,raw.accumulator),expected);}catch{matches=false;}
  }
  if(missingReceipts||staleReceipts||!matches)return {subject,state:'repair_required' as const,missingReceipts,staleReceipts,projection:null};
  return {subject,state:'verified_snapshot' as const,missingReceipts:0,staleReceipts:0,projection:projectReputationAccumulator(kind,expected)};
 },{readOnly:true});
}
