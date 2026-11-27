import type {Transaction,QueryDocumentSnapshot} from 'firebase-admin/firestore';
import {isStoreRole} from '../../src/utils/storeSecurity.js';
import {FieldPath} from 'firebase-admin/firestore';
import {adminDb} from '../firebaseAdmin.js';
import {readOwnedFreelanceStore} from './freelanceStoreRepresentationService.js';
import {assertFreelanceReputationLocal,readFreelanceReputationContext,REPUTATION_HISTORY_SCAN_LIMIT} from './freelanceReputationService.js';
import {reputationIndexEnabled} from './freelanceReputationIndexPreparation.js';
import {digestVariablePaymentSources,canonicalVariablePaymentRecord} from './freelanceVariablePaymentBasisService.js';
import {emptyReputationAccumulator,incrementReputationExperience,incrementReleasedReputation,validateReputationAccumulator,projectReputationAccumulator,type ReputationAccumulator} from '../../shared/freelanceReputationAccumulator.js';
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
 return adminDb.runTransaction(tx=>auditInTransaction(tx,uid,kind),{readOnly:true});
}
async function auditInTransaction(tx:Transaction,uid:string,kind:'professional'|'personal_requester'|'store_requester'){
  const store=kind==='store_requester'?await readOwnedFreelanceStore(tx,uid):null;
  if(kind==='store_requester'&&!store)throw Error('FREELANCE_STORE_FORBIDDEN');
  const subject:ReputationSubject={kind,id:store?.storeId??uid};
  const docs=await tx.get(adminDb.collection('freelanceOffersV1').where(kind==='professional'?'selectedApplicantUid':'ownerUid','==',uid)
   .where('status','==','completed').orderBy(FieldPath.documentId()).limit(REPUTATION_HISTORY_SCAN_LIMIT+1));
  if(docs.size>REPUTATION_HISTORY_SCAN_LIMIT)return {subject,state:'requires_batched_audit' as const,missingReceipts:null,staleReceipts:null,projection:null};
  let expected=emptyReputationAccumulator(kind),missingReceipts=0,staleReceipts=0;
  ({expected,missingReceipts,staleReceipts}=await auditPage(tx,uid,subject,docs.docs,expected));
  return finishAudit(tx,uid,subject,expected,missingReceipts,staleReceipts);
}

/** Read-only team access; legacy store ID is the ERP's current owner scope.
 * Resolve canonical identity and membership in the same consistent snapshot.
 * No power to contract, rate, contest or read private records is granted. */
export async function readStoreTeamReputation(uid:string,legacyStoreId:unknown){
 assertFreelanceReputationLocal();
 if(!reputationIndexEnabled())throw Error('FREELANCE_FORBIDDEN');
 if(!validFreelanceId(uid)||!validFreelanceId(legacyStoreId))throw Error('FREELANCE_INVALID');
 return adminDb.runTransaction(async tx=>{
  const store=await readOwnedFreelanceStore(tx,legacyStoreId);
  if(!store)throw Error('FREELANCE_STORE_FORBIDDEN');
  if(uid!==legacyStoreId){
   const member=(await tx.get(adminDb.doc('stores/'+store.storeId+'/members/'+uid))).data();
   if(!member||member.userId!==uid||member.storeId!==store.storeId||member.status!=='active'||!isStoreRole(member.role)||member.role==='owner')throw Error('FREELANCE_STORE_FORBIDDEN');
  }
  const {subject,state,projection}=await auditInTransaction(tx,legacyStoreId,'store_requester');
  if(subject.id!==store.storeId)throw Error('FREELANCE_STORE_FORBIDDEN');
  return {legacyStoreId,subject,state,projection};
 },{readOnly:true});
}

async function auditPage(tx:Transaction,uid:string,subject:ReputationSubject,docs:readonly QueryDocumentSnapshot[],initial:ReputationAccumulator){
 const kind=subject.kind,store=kind==='store_requester'?{storeId:subject.id}:null;
 let expected=initial,missingReceipts=0,staleReceipts=0;
  for(const doc of docs){
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

 return {expected,missingReceipts,staleReceipts};
}
async function finishAudit(tx:Transaction,uid:string,subject:ReputationSubject,expected:ReputationAccumulator,missingReceipts:number,staleReceipts:number){
 const kind=subject.kind;
  const raw=(await tx.get(adminDb.doc('freelanceReputationIndexesV1/'+digestVariablePaymentSources({subject,representativeUid:uid})))).data();
  let matches=false;
  if(!raw)matches=expected.completedContracts===0;
  else if(Object.keys(raw).length===4&&raw.schemaVersion===1&&raw.representativeUid===uid&&equal(raw.subject,subject)){
   try{matches=equal(validateReputationAccumulator(kind,raw.accumulator),expected);}catch{matches=false;}
  }
  if(missingReceipts||staleReceipts||!matches)return {subject,state:'repair_required' as const,missingReceipts,staleReceipts,projection:null};
  return {subject,state:'verified_snapshot' as const,missingReceipts:0,staleReceipts:0,projection:projectReputationAccumulator(kind,expected)};
}
/** Internal bounded batched audit. Every page and final index read use the
 * same Firestore snapshot timestamp, not a sequence of independently current
 * queries. A budget exhaustion returns no total. No persisted certificate or
 * public route; callers must not treat this as a live index guarantee. */
export async function auditOwnFreelanceReputationIndexBatched(uid:string,kind:unknown,options:{pageSize?:number;maxPages?:number}={}){
 assertFreelanceReputationLocal();
 if(!reputationIndexEnabled())throw Error('FREELANCE_FORBIDDEN');
 const pageSize=options.pageSize??25,maxPages=options.maxPages??40;
 if(!validFreelanceId(uid)||(kind!=='professional'&&kind!=='personal_requester'&&kind!=='store_requester')||!Number.isInteger(pageSize)||pageSize<1||pageSize>50||!Number.isInteger(maxPages)||maxPages<1||maxPages>40)throw Error('FREELANCE_INVALID');
 const scope=await adminDb.runTransaction(async tx=>{
  const store=kind==='store_requester'?await readOwnedFreelanceStore(tx,uid):null;
  if(kind==='store_requester'&&!store)throw Error('FREELANCE_STORE_FORBIDDEN');
  const subject:ReputationSubject={kind,id:store?.storeId??uid};
  const ref=adminDb.doc('freelanceReputationIndexesV1/'+digestVariablePaymentSources({subject,representativeUid:uid}));
  const snapshot=await tx.get(ref);
  return {subject,readTime:snapshot.readTime};
 },{readOnly:true});
 const {subject,readTime}=scope;
 let after:string|undefined,expected=emptyReputationAccumulator(kind),missingReceipts=0,staleReceipts=0;
 const readOptions={readOnly:true as const,readTime};
 for(let page=0;page<maxPages;page++){
  const result=await adminDb.runTransaction(async tx=>{
   let q=adminDb.collection('freelanceOffersV1').where(kind==='professional'?'selectedApplicantUid':'ownerUid','==',uid).where('status','==','completed').orderBy(FieldPath.documentId()).limit(pageSize+1);
   if(after!==undefined)q=q.startAfter(after);
   const snap=await tx.get(q);
   if(!snap.readTime.isEqual(readTime))throw Error('FREELANCE_REPUTATION_INDEX_CONFLICT');
   const docs=snap.docs.slice(0,pageSize);
   const partial=await auditPage(tx,uid,subject,docs,expected);
   return {...partial,next:snap.size>pageSize?docs[docs.length-1].id:undefined};
  },readOptions);
  expected=result.expected;missingReceipts+=result.missingReceipts;staleReceipts+=result.staleReceipts;after=result.next;
  if(after===undefined){
   const result=await adminDb.runTransaction(tx=>finishAudit(tx,uid,subject,expected,missingReceipts,staleReceipts),readOptions);
   // Verify current owner authority again; historical authorization is not
   // sufficient after a revocation. Internal calls only.
   if(kind==='store_requester')await adminDb.runTransaction(async tx=>{
    const store=await readOwnedFreelanceStore(tx,uid);
    if(!store||store.storeId!==subject.id)throw Error('FREELANCE_STORE_FORBIDDEN');
   },{readOnly:true});
   return {...result,pages:page+1,asOf:readTime.toDate().toISOString()};
  }
 }
 return {subject,state:'requires_batched_audit' as const,missingReceipts:null,staleReceipts:null,projection:null,pages:maxPages,asOf:readTime.toDate().toISOString()};
}
