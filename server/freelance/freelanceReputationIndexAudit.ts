import {isSocialAddress,isDocumentId,matchesSocialAddressRecord,projectSocialAddress} from '../identity/publicSocialAddressPolicy.js';
import {coverageRef,indexDigest,checkedCoverage,writeCoverage,readReputationMaintenance} from './freelanceReputationCoverage.js';
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
export const certifiedReputationReadEnabled=()=>reputationIndexEnabled()&&process.env.KYRUB_FREELANCE_REPUTATION_CERTIFIED_READ_TEST_ONLY==='true';
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
  if((await readReputationMaintenance(tx)).active)return {subject,state:'repair_required' as const,missingReceipts:null,staleReceipts:null,projection:null};
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
  const {subject,state,projection}=certifiedReputationReadEnabled()?await readCertifiedInTransaction(tx,legacyStoreId,{kind:'store_requester',id:store.storeId}):await auditInTransaction(tx,legacyStoreId,'store_requester');
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
  const maintenance=await readReputationMaintenance(tx);
  if(maintenance.active)throw Error('FREELANCE_REPUTATION_INDEX_CONFLICT');
  const [snapshot,witness]=await tx.getAll(ref,coverageRef({subject,representativeUid:uid}));
  return {subject,readTime:snapshot.readTime,baselineDigest:indexDigest(snapshot.data()),baselineWitness:indexDigest(witness.data()),epoch:maintenance.epoch};
 },{readOnly:true});
 const {subject,readTime,baselineDigest,baselineWitness,epoch}=scope;
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
   return {...result,pages:page+1,asOf:readTime.toDate().toISOString(),baselineDigest,baselineWitness,epoch};
  }
 }
 return {subject,state:'requires_batched_audit' as const,missingReceipts:null,staleReceipts:null,projection:null,pages:maxPages,asOf:readTime.toDate().toISOString(),baselineDigest,baselineWitness,epoch};
}

/** Internal certification is conditional on the exact index and source
 * witness still matching the audited snapshot. No client supplied proof. */
export async function certifyOwnFreelanceReputationIndex(uid:string,kind:unknown){
 const audited=await auditOwnFreelanceReputationIndexBatched(uid,kind);
 const subject=audited.subject,scope={subject,representativeUid:uid};
 return adminDb.runTransaction(async tx=>{
  if(!reputationIndexEnabled())throw Error('FREELANCE_FORBIDDEN');
  if(subject.kind==='store_requester'){
   const store=await readOwnedFreelanceStore(tx,uid);
   if(!store||store.storeId!==subject.id)throw Error('FREELANCE_STORE_FORBIDDEN');
  }
  const maintenance=await readReputationMaintenance(tx);
  if(maintenance.active||maintenance.epoch!==audited.epoch)return {certified:false,state:'snapshot_changed' as const};
  const [index,witness]=await tx.getAll(adminDb.doc('freelanceReputationIndexesV1/'+digestVariablePaymentSources(scope)),coverageRef(scope));
  if(indexDigest(index.data())!==audited.baselineDigest||indexDigest(witness.data())!==audited.baselineWitness)return {certified:false,state:'snapshot_changed' as const};
  if(audited.state!=='verified_snapshot'){
   writeCoverage(tx,scope,null);
   return {certified:false,state:audited.state};
  }
  writeCoverage(tx,scope,audited.baselineDigest,maintenance.epoch);
  return {certified:true,state:'verified_snapshot' as const};
 });
}
/** Constant-document read for the isolated candidate. It trusts the
 * transaction-maintained witness, not a client assertion. Administrative
 * bypass/imports still require explicit invalidation and fresh audit. */
export async function readCertifiedFreelanceReputationIndex(uid:string,kind:unknown){
 assertFreelanceReputationLocal();
 if(!reputationIndexEnabled())throw Error('FREELANCE_FORBIDDEN');
 if(!validFreelanceId(uid)||(kind!=='professional'&&kind!=='personal_requester'&&kind!=='store_requester'))throw Error('FREELANCE_INVALID');
 return adminDb.runTransaction(async tx=>{
  const store=kind==='store_requester'?await readOwnedFreelanceStore(tx,uid):null;
  if(kind==='store_requester'&&!store)throw Error('FREELANCE_STORE_FORBIDDEN');
  const subject:ReputationSubject={kind,id:store?.storeId??uid};
  return readCertifiedInTransaction(tx,uid,subject);
 },{readOnly:true});
}
async function readCertifiedInTransaction(tx:Transaction,uid:string,subject:ReputationSubject){
 const kind=subject.kind,scope={subject,representativeUid:uid};
  const maintenance=await readReputationMaintenance(tx);
  if(maintenance.active)return {subject,state:'repair_required' as const,projection:null};
  const [index,witness]=await tx.getAll(adminDb.doc('freelanceReputationIndexesV1/'+digestVariablePaymentSources(scope)),coverageRef(scope));
  const raw=index.data(),w=checkedCoverage(scope,witness.data());
  if(!w||w.epoch!==maintenance.epoch||w.verifiedDigest!==indexDigest(raw))return {subject,state:'repair_required' as const,projection:null};
  try{
   if(raw&&(Object.keys(raw).length!==4||raw.schemaVersion!==1||raw.representativeUid!==uid||!equal(raw.subject,subject)))throw Error('FREELANCE_REPUTATION_INDEX_CONFLICT');
   const a=raw?validateReputationAccumulator(kind,raw.accumulator):emptyReputationAccumulator(kind);
   return {subject,state:'verified_snapshot' as const,projection:projectReputationAccumulator(kind,a)};
  }catch{return {subject,state:'repair_required' as const,projection:null};}
}

/** Existing authenticated personal endpoint may opt into the constant-read
 * implementation only in isolated homologation. No expensive fallback for
 * missing/invalid coverage; repair is an internal audited operation. */
export async function readOwnReputationForWorkspace(uid:string,kind:unknown){
 return certifiedReputationReadEnabled()?readCertifiedFreelanceReputationIndex(uid,kind):auditOwnFreelanceReputationIndex(uid,kind);
}

/** Minimal discovery projection, not an authorization to publish private
 * ratings. Visibility and certified totals are checked in one snapshot.
 * Hidden, absent and uncertified subjects deliberately look identical. */
export async function readVisibleFreelanceExperience(viewerUid:string,targetUid:unknown){
 assertFreelanceReputationLocal();
 if(!certifiedReputationReadEnabled()||process.env.KYRUB_FREELANCE_PUBLIC_EXPERIENCE_TEST_ONLY!=='true')throw Error('FREELANCE_FORBIDDEN');
 if(!validFreelanceId(viewerUid)||!validFreelanceId(targetUid))throw Error('FREELANCE_INVALID');
 return adminDb.runTransaction(async tx=>{
  const profile=(await tx.get(adminDb.doc('users/'+targetUid))).data();
  const hidden={experience:null};
  if(profile?.isProfileVisible!==true)return hidden;
  return readExperienceCounts(tx,targetUid);
 },{readOnly:true});
}
async function readExperienceCounts(tx:Transaction,targetUid:string,includeReputation=false){
  const hidden=includeReputation?{experience:null,reputations:null}:{experience:null};
  const professional=await readCertifiedInTransaction(tx,targetUid,{kind:'professional',id:targetUid});
  const requester=await readCertifiedInTransaction(tx,targetUid,{kind:'personal_requester',id:targetUid});
  if(professional.state!=='verified_snapshot'||requester.state!=='verified_snapshot'||!professional.projection||!requester.projection)return hidden;
  const experience={completedServices:professional.projection.completedContracts,completedHires:requester.projection.completedContracts};
  const minimal=(p:typeof professional.projection)=>({ratingCount:p.aggregate.ratingCount,mean:p.aggregate.mean});
  return includeReputation?{experience,reputations:{professional:minimal(professional.projection),personalRequester:minimal(requester.projection)}}:{experience};
}

/** Resolve both immutable address indices and live visibility together with
 * the minimal certified counts. No UID is returned to the public page. */
export async function readAddressFreelanceExperience(viewerUid:string,identifier:unknown,includeReputation=false,ownerOnly=false){
 assertFreelanceReputationLocal();
 if(!certifiedReputationReadEnabled()||process.env.KYRUB_FREELANCE_PUBLIC_EXPERIENCE_TEST_ONLY!=='true')throw Error('FREELANCE_FORBIDDEN');
 if(includeReputation&&process.env.KYRUB_FREELANCE_PUBLIC_REPUTATION_TEST_ONLY!=='true')throw Error('FREELANCE_FORBIDDEN');
 if(!validFreelanceId(viewerUid)||typeof identifier!=='string'||!isSocialAddress('profile',identifier))throw Error('FREELANCE_INVALID');
 return adminDb.runTransaction(tx=>readAddressSummaryInTransaction(tx,viewerUid,identifier,includeReputation,ownerOnly),{readOnly:true});
}
async function readAddressSummaryInTransaction(tx:Transaction,viewerUid:string,identifier:string,includeReputation:boolean,ownerOnly:boolean){
  const hidden=includeReputation?{experience:null,reputations:null}:{experience:null};
  const mapping=(await tx.get(adminDb.doc('public_social_addresses/profile:'+identifier))).data();
  if(!mapping||!isDocumentId(mapping.targetId)||!matchesSocialAddressRecord(mapping,'profile',identifier,mapping.targetId))return hidden;
  const uid=mapping.targetId;
  if(ownerOnly&&uid!==viewerUid)return hidden;
  const reverse=(await tx.get(adminDb.doc('public_social_address_targets/profile:'+uid))).data();
  if(!matchesSocialAddressRecord(reverse,'profile',identifier,uid))return hidden;
  const ref=adminDb.doc('users/'+uid),source=(await tx.get(ref)).data();
  if(source?.isProfileVisible!==true)return hidden;
  const profile=(await tx.get(ref.collection('public_profile').doc('main'))).data();
  if(!projectSocialAddress({kind:'profile',identifier,targetId:uid},source,profile))return hidden;
  return readExperienceCounts(tx,uid,includeReputation);

}

export async function readOwnReputationSquarePreview(uid:string,identifier:unknown){
 if(process.env.KYRUB_FREELANCE_REPUTATION_SQUARE_TEST_ONLY!=='true')throw Error('FREELANCE_FORBIDDEN');
 return readAddressFreelanceExperience(uid,identifier,true,true);
}

const squarePublicationEnabled=()=>certifiedReputationReadEnabled()&&process.env.KYRUB_FREELANCE_PUBLIC_EXPERIENCE_TEST_ONLY==='true'&&process.env.KYRUB_FREELANCE_PUBLIC_REPUTATION_TEST_ONLY==='true'&&process.env.KYRUB_FREELANCE_REPUTATION_SQUARE_TEST_ONLY==='true'&&process.env.KYRUB_FREELANCE_REPUTATION_SQUARE_PUBLISH_TEST_ONLY==='true';
const squarePostId=(uid:string,requestId:string)=>'reputation_'+digestVariablePaymentSources({uid,requestId});
const validSquarePost=(v:unknown):v is string=>typeof v==='string'&&/^reputation_[a-f0-9]{64}$/.test(v);
const squareWindow=24*60*60*1000;
/** Only a server-created reference attests this special publication.
 * Store no numeric snapshot in either document. Request ID is idempotent. */
export async function publishOwnReputationSquare(uid:string,identifier:unknown,requestId:unknown,confirmed:unknown){
 assertFreelanceReputationLocal();
 if(!squarePublicationEnabled())throw Error('FREELANCE_FORBIDDEN');
 if(!validFreelanceId(uid)||typeof identifier!=='string'||!isSocialAddress('profile',identifier)||!validFreelanceId(requestId)||confirmed!==true)throw Error('FREELANCE_INVALID');
 const postId=squarePostId(uid,requestId),postRef=adminDb.doc('social_posts/'+postId),proofRef=adminDb.doc('freelanceReputationSquarePostsV1/'+postId);
 return adminDb.runTransaction(async tx=>{
  const [post,proof]=await tx.getAll(postRef,proofRef);
  const expected={schemaVersion:1,postId,authorId:uid,identifier,requestId};
  if(proof.exists){
   const raw=proof.data();
   if(!post.exists||!raw||!equal(raw,{...expected,createdAtIso:raw.createdAtIso})||post.get('authorId')!==uid||post.get('createdAtIso')!==raw.createdAtIso)throw Error('FREELANCE_REPUTATION_CONFLICT');
   return {postId,created:false};
  }
  if(post.exists)throw Error('FREELANCE_REPUTATION_CONFLICT');
  const summary=await readAddressSummaryInTransaction(tx,uid,identifier,true,true);
  if(!summary.experience||!summary.reputations)throw Error('FREELANCE_FORBIDDEN');
  const userRef=adminDb.doc('users/'+uid),[source,publicProfile]=await tx.getAll(userRef,userRef.collection('public_profile').doc('main'));
  const identity=projectSocialAddress({kind:'profile',identifier,targetId:uid},source.data(),publicProfile.data());
  if(!identity)throw Error('FREELANCE_FORBIDDEN');
  const now=new Date(),createdAtIso=now.toISOString();
  tx.create(proofRef,{...expected,createdAtIso});
  tx.create(postRef,{postId,sourcePostId:postId,authorId:uid,authorName:identity.name,authorAvatar:identity.image,content:'Conheça minha Experiência e Reputações no Kyrub!',publicationType:'feed',taggedUsers:[],taggedUserIds:[],mediaUrls:[],visibility:'public',audienceIds:[],createdAtIso,createdAt:now,updatedAt:now});
  return {postId,created:true};
 });
}
export async function readReputationSquarePublication(uid:string,postId:unknown){
 assertFreelanceReputationLocal();
 if(!squarePublicationEnabled())throw Error('FREELANCE_FORBIDDEN');
 if(!validFreelanceId(uid)||!validSquarePost(postId))throw Error('FREELANCE_INVALID');
 return adminDb.runTransaction(tx=>readReputationSquareInTransaction(tx,postId),{readOnly:true});
}
async function readReputationSquareInTransaction(tx:Transaction,postId:string){
  const hidden={experience:null,reputations:null};
  const [post,proof]=await tx.getAll(adminDb.doc('social_posts/'+postId),adminDb.doc('freelanceReputationSquarePostsV1/'+postId));
  const p=post.data(),r=proof.data();
  if(!p||!r||Object.keys(r).length!==6||r.schemaVersion!==1||r.postId!==postId||!validFreelanceId(r.authorId)||!validFreelanceId(r.requestId)||squarePostId(r.authorId,r.requestId)!==postId||typeof r.identifier!=='string'||!isSocialAddress('profile',r.identifier)||typeof r.createdAtIso!=='string'||p.createdAtIso!==r.createdAtIso||p.authorId!==r.authorId||p.postId!==postId||p.visibility!=='public'||p.publicationType!=='feed')return hidden;
  let distributedAt=r.createdAtIso;
  if(p.squareDistributedAtIso!==undefined||p.squareForwardedById!==undefined){
   if(typeof p.squareDistributedAtIso!=='string'||!validFreelanceId(p.squareForwardedById))return hidden;
   const receipt=(await tx.get(adminDb.doc('freelanceReputationSquarePostsV1/'+postId+'/squareForwards/'+p.squareForwardedById))).data();
   if(!receipt||!equal(receipt,{schemaVersion:1,postId,actorId:p.squareForwardedById,destination:'square',forwardedAtIso:p.squareDistributedAtIso})||Date.parse(p.squareDistributedAtIso)<Date.parse(r.createdAtIso))return hidden;
   distributedAt=p.squareDistributedAtIso;
  }
  const elapsed=Date.now()-Date.parse(distributedAt);
  if(!Number.isFinite(elapsed)||elapsed<0||elapsed>=squareWindow)return hidden;
  return readAddressSummaryInTransaction(tx,r.authorId,r.identifier,true,true);

}
export async function assertReputationSquareInteraction(tx:Transaction,postId:string){
 if(!postId.startsWith('reputation_'))return;
 if(!squarePublicationEnabled()||!validSquarePost(postId))throw Error('FREELANCE_FORBIDDEN');
 const summary=await readReputationSquareInTransaction(tx,postId);
 if(!summary.experience||!summary.reputations)throw Error('FREELANCE_FORBIDDEN');
}
/** Preserve existing comment collection and parent thread identity, but
 * require a current valid reputation publication in the write transaction. */
export async function commentReputationSquare(uid:string,postId:unknown,text:unknown,parentCommentId:unknown){
 assertFreelanceReputationLocal();
 if(!validFreelanceId(uid)||!validSquarePost(postId)||typeof text!=='string'||text.trim().length<1||text.length>1000||(parentCommentId!==undefined&&!validFreelanceId(parentCommentId)))throw Error('FREELANCE_INVALID');
 const ref=adminDb.collection('social_post_comments').doc();
 return adminDb.runTransaction(async tx=>{
  await assertReputationSquareInteraction(tx,postId);
  if(parentCommentId!==undefined){
   const parent=await tx.get(adminDb.doc('social_post_comments/'+parentCommentId));
   if(!parent.exists||parent.get('postId')!==postId)throw Error('FREELANCE_INVALID');
  }
  const profile=(await tx.get(adminDb.doc('users/'+uid))).data();
  const name=typeof profile?.name==='string'&&profile.name.trim()?profile.name.trim().slice(0,160):'Kairubido';
  const avatar=typeof profile?.photoUrl==='string'?profile.photoUrl.slice(0,2048):'';
  const now=new Date();
  tx.create(ref,{postId,authorId:uid,authorName:name,authorAvatar:avatar,text:text.trim(),...(parentCommentId===undefined?{}:{parentCommentId}),createdAtIso:now.toISOString(),createdAt:now});
 });
}

/** A forward distributes the original card, never clones it. Its last
 * distribution time is separate from creation; same original ID for comments
 * and seeds. One accepted forward per actor/original/destination in 24h.
 * This candidate only supports currently visible Praça publications. */
export async function forwardReputationSquare(uid:string,postId:unknown,destination:unknown,confirmed:unknown){
 assertFreelanceReputationLocal();
 if(!squarePublicationEnabled()||process.env.KYRUB_FREELANCE_REPUTATION_SQUARE_FORWARD_TEST_ONLY!=='true')throw Error('FREELANCE_FORBIDDEN');
 if(!validFreelanceId(uid)||!validSquarePost(postId)||destination!=='square'||confirmed!==true)throw Error('FREELANCE_INVALID');
 const postRef=adminDb.doc('social_posts/'+postId),receiptRef=adminDb.doc('freelanceReputationSquarePostsV1/'+postId+'/squareForwards/'+uid);
 return adminDb.runTransaction(async tx=>{
  await assertReputationSquareInteraction(tx,postId);
  const prior=(await tx.get(receiptRef)).data();
  const now=new Date(),forwardedAtIso=now.toISOString();
  if(prior){
   if(typeof prior.forwardedAtIso!=='string'||!equal(prior,{schemaVersion:1,postId,actorId:uid,destination:'square',forwardedAtIso:prior.forwardedAtIso}))throw Error('FREELANCE_REPUTATION_CONFLICT');
   const elapsed=now.getTime()-Date.parse(prior.forwardedAtIso);
   if(!Number.isFinite(elapsed)||elapsed<0)throw Error('FREELANCE_REPUTATION_CONFLICT');
   if(elapsed<squareWindow)throw Error('FREELANCE_CONFLICT');
  }
  tx.set(receiptRef,{schemaVersion:1,postId,actorId:uid,destination:'square',forwardedAtIso});
  tx.update(postRef,{squareDistributedAtIso:forwardedAtIso,squareForwardedById:uid,updatedAt:now});
  return {postId,forwardedAtIso};
 });
}
