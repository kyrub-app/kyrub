import type {Transaction} from 'firebase-admin/firestore';
import {FieldPath} from 'firebase-admin/firestore';
import {readOwnedFreelanceStore} from './freelanceStoreRepresentationService.js';
import {validFreelanceId,type FreelanceOffer} from '../../shared/freelanceLifecycle.js';
import {adminDb,getFirebaseAdminProjectId} from '../firebaseAdmin.js';
import {readAttendanceContext} from './freelanceAttendanceScheduleService.js';
import {freelanceReputationParties,freelanceReputationSlot,type ReputationSubject} from '../../shared/freelanceReputation.js';
import {canonicalVariablePaymentRecord,digestVariablePaymentSources} from './freelanceVariablePaymentBasisService.js';

const fail=():never=>{throw Error('FREELANCE_REPUTATION_CONFLICT');};
export const assertFreelanceReputationLocal=()=>{if(process.env.KYRUB_FREELANCE_REPUTATION_TEST_ONLY!=='true'||process.env.KYRUB_FREELANCE_LOCAL_HOMOLOGATION!=='true'||process.env.VERCEL||process.env.VERCEL_ENV||process.env.FIREBASE_SERVICE_ACCOUNT_JSON||process.env.GOOGLE_APPLICATION_CREDENTIALS||!['127.0.0.1:8088','localhost:8088'].includes(process.env.FIRESTORE_EMULATOR_HOST??'')||!['127.0.0.1:9099','localhost:9099'].includes(process.env.FIREBASE_AUTH_EMULATOR_HOST??'')||getFirebaseAdminProjectId()!=='kyrub-security-test')throw Error('FREELANCE_FORBIDDEN');};
const iso=(v:unknown):v is string=>typeof v==='string'&&Number.isFinite(Date.parse(v))&&new Date(Date.parse(v)).toISOString()===v;
// Stars are a test-only candidate for the previously discussed evaluation
// format. No criteria, final scale approval, deadline, reward or public read.
const stars=(v:unknown):v is number=>typeof v==='number'&&Number.isInteger(v)&&v>=1&&v<=5;
type Role='requester'|'worker';
type Contestation={schemaVersion:1;offerId:string;contractDigest:string;ratingDigest:string;challengerUid:string;ratingRole:Role;reason:string;requestedAt:string;status:'pending'};
const reasonText=(value:unknown)=>{
 if(typeof value!=='string'||!value.trim()||value.trim().length>1000||/[\u0000-\u0008\u000b-\u001f\u007f]/.test(value))throw Error('FREELANCE_INVALID');
 return value.trim();
};
type Slot={schemaVersion:1;offerId:string;contractDigest:string;role:Role;authorUid:string;subject:ReputationSubject;stars:number;submittedAt:string};
export async function readFreelanceReputationContext(tx:Transaction,uid:string,id:string){
 assertFreelanceReputationLocal();
 const c=await readAttendanceContext(tx,uid,id),parties=freelanceReputationParties(c.offer,c.application);
 const contractDigest=digestVariablePaymentSources({parties,selectedAt:c.offer.selectedAt,contractedAt:c.offer.contractedAt,startedAt:c.offer.startedAt,completionRequestedAt:c.offer.completionRequestedAt,paymentMinor:c.offer.paymentMinor,paymentTerms:c.offer.paymentTerms??null,workTerms:c.offer.workTerms??null,requesterStore:c.offer.requesterStore??null});
 const collection=c.ref.collection('reputationPrivateV1'),refs={requester:collection.doc('requester'),worker:collection.doc('worker')};
 const [a,b]=await tx.getAll(refs.requester,refs.worker);
 function checked(raw:unknown,role:Role):Slot|undefined{
  if(raw===undefined)return undefined;
  if(!raw||typeof raw!=='object'||Array.isArray(raw))return fail();
  const r=raw as Slot,authorUid=role==='requester'?parties.requesterUid:parties.workerUid;
  const expected=freelanceReputationSlot(c.offer,c.application,authorUid);
  if(Object.keys(r).length!==8||r.schemaVersion!==1||r.offerId!==id||r.contractDigest!==contractDigest||r.role!==role||r.authorUid!==authorUid||canonicalVariablePaymentRecord(r.subject)!==canonicalVariablePaymentRecord(expected.subject)||!stars(r.stars)||!iso(r.submittedAt)||Date.parse(r.submittedAt)<Date.parse(parties.completedAt))return fail();
  return r;
 }
 const slots={requester:checked(a.data(),'requester'),worker:checked(b.data(),'worker')};
 return {c,parties,contractDigest,refs,slots};
}
const opposite=(role:Role):Role=>role==='requester'?'worker':'requester';
/** Only a recipient of a released rating can challenge it. The original
 * immutable rating remains the source of truth; no scoring or sanction write. */
export async function contestationContext(tx:Transaction,x:Awaited<ReturnType<typeof readFreelanceReputationContext>>){
 const role=x.c.actor,other=opposite(role),own=x.slots[role],rating=x.slots[other];
 const ref=adminDb.doc('freelanceReputationContestsV1/'+digestVariablePaymentSources([x.parties.offerId,other]));
 const raw=(await tx.get(ref)).data() as Contestation|undefined;
 const ratingDigest=rating?digestVariablePaymentSources(rating):null;
 if(raw){
  if(!own||!rating||Object.keys(raw).length!==9||raw.schemaVersion!==1||raw.offerId!==x.parties.offerId||raw.contractDigest!==x.contractDigest||raw.ratingDigest!==ratingDigest||raw.challengerUid!==(role==='requester'?x.parties.requesterUid:x.parties.workerUid)||raw.ratingRole!==other||raw.status!=='pending'||!iso(raw.requestedAt)||Date.parse(raw.requestedAt)<Math.max(Date.parse(own.submittedAt),Date.parse(rating.submittedAt)))return fail();
  try{if(reasonText(raw.reason)!==raw.reason)return fail();}catch{return fail();}
 }
 return {role,other,own,rating,ref,raw,ratingDigest};
}
async function requireContestationAuthority(tx:Transaction,x:Awaited<ReturnType<typeof readFreelanceReputationContext>>,uid:string){
 if(x.c.actor==='requester'&&x.parties.requester.kind==='store_requester'){
  const store=await readOwnedFreelanceStore(tx,uid);
  if(!store||store.storeId!==x.parties.requester.id)throw Error('FREELANCE_STORE_FORBIDDEN');
 }
}
export async function readOwnFreelanceReputationContestation(uid:string,id:string){
 return adminDb.runTransaction(async tx=>{
  const x=await readFreelanceReputationContext(tx,uid,id);
  await requireContestationAuthority(tx,x,uid);
  const q=await contestationContext(tx,x);
  return {offerId:id,eligible:!!q.own&&!!q.rating&&!q.raw,ratingDigest:q.own&&q.rating?q.ratingDigest:null,contestation:q.raw?{status:q.raw.status,reason:q.raw.reason,requestedAt:q.raw.requestedAt}:null};
 },{readOnly:true});
}
export async function contestFreelanceReputation(uid:string,id:string,input:unknown){
 assertFreelanceReputationLocal();
 if(!input||typeof input!=='object'||Array.isArray(input))throw Error('FREELANCE_INVALID');
 const b=input as Record<string,unknown>;
 if(Object.keys(b).length!==3||b.confirmed!==true||typeof b.ratingDigest!=='string'||!/^[a-f0-9]{64}$/.test(b.ratingDigest))throw Error('FREELANCE_INVALID');
 const reason=reasonText(b.reason);
 return adminDb.runTransaction(async tx=>{
  const x=await readFreelanceReputationContext(tx,uid,id);
  await requireContestationAuthority(tx,x,uid);
  const q=await contestationContext(tx,x);
  if(!q.own||!q.rating||b.ratingDigest!==q.ratingDigest)return fail();
  if(q.raw){if(q.raw.reason!==reason)return fail();return {created:false,status:q.raw.status,requestedAt:q.raw.requestedAt};}
  const requestedAt=new Date().toISOString();
  if(Date.parse(requestedAt)<Math.max(Date.parse(q.own.submittedAt),Date.parse(q.rating.submittedAt)))return fail();
  const record:Contestation={schemaVersion:1,offerId:id,contractDigest:x.contractDigest,ratingDigest:q.ratingDigest!,challengerUid:uid,ratingRole:q.other,reason,requestedAt,status:'pending'};
  tx.create(q.ref,record);
  return {created:true,status:record.status,requestedAt};
 });

}
function view(x:Awaited<ReturnType<typeof readFreelanceReputationContext>>){
 const role=x.c.actor,other=role==='requester'?'worker':'requester',own=x.slots[role],peer=x.slots[other],released=!!own&&!!peer;
 const project=(s:Slot)=>({subject:s.subject,stars:s.stars,submittedAt:s.submittedAt});
 // Before bilateral submission, reveal neither the other's score nor timing.
 return {offerId:x.parties.offerId,role,own:own?project(own):null,received:released?project(peer!):null,publicationState:released?'bilateral_released':'waiting_bilateral',rewardsGranted:false};
}
export async function readFreelanceReputation(uid:string,id:string){
 return adminDb.runTransaction(async tx=>view(await readFreelanceReputationContext(tx,uid,id)),{readOnly:true});
}
export async function submitFreelanceReputation(uid:string,id:string,input:unknown){
 assertFreelanceReputationLocal();
 if(!input||typeof input!=='object'||Array.isArray(input))throw Error('FREELANCE_INVALID');
 const b=input as Record<string,unknown>;
 if(Object.keys(b).length!==2||b.confirmed!==true||!stars(b.stars))throw Error('FREELANCE_INVALID');
 return adminDb.runTransaction(async tx=>{
  const x=await readFreelanceReputationContext(tx,uid,id),role=x.c.actor,prior=x.slots[role];
  if(prior){if(prior.stars!==b.stars)return fail();return {...view(x),changed:false};}
  const submittedAt=new Date().toISOString();
  if(Date.parse(submittedAt)<Date.parse(x.parties.completedAt))return fail();
  const slot:Slot={schemaVersion:1,offerId:id,contractDigest:x.contractDigest,role,authorUid:uid,subject:freelanceReputationSlot(x.c.offer,x.c.application,uid).subject,stars:b.stars as number,submittedAt};
  tx.create(x.refs[role],slot);
  return {...view({...x,slots:{...x.slots,[role]:slot}}),changed:true};
 });
}

/** Private profile projection over canonical contracts. No public reputation,
 * new write index, lifetime averages or rewards. Page cursor follows scanned
 * contracts (even when none are released), never the count of released rows.
 * Corporate access is limited to the current authorized representative's own
 * historical contracts; ownership-transfer policy is not defined here. */
export async function readOwnFreelanceReputationProfile(uid:string,kind:unknown,cursor?:unknown){
 assertFreelanceReputationLocal();
 if(!validFreelanceId(uid)||(kind!=='professional'&&kind!=='personal_requester'&&kind!=='store_requester')||(cursor!==undefined&&!validFreelanceId(cursor)))throw Error('FREELANCE_INVALID');
 return adminDb.runTransaction(async tx=>{
  const store=kind==='store_requester'?await readOwnedFreelanceStore(tx,uid):null;
  if(kind==='store_requester'&&!store)throw Error('FREELANCE_STORE_FORBIDDEN');
  const subject:ReputationSubject={kind,id:store?.storeId??uid};
  let q=adminDb.collection('freelanceOffersV1').where(kind==='professional'?'selectedApplicantUid':'ownerUid','==',uid).orderBy(FieldPath.documentId()).limit(21);
  if(typeof cursor==='string')q=q.startAfter(cursor);
  const docs=await tx.get(q),page=docs.docs.slice(0,20),entries=[];
  for(const doc of page){
   const o=doc.data() as FreelanceOffer;
   if(o.id!==doc.id||!validFreelanceId(o.ownerUid)||(kind==='professional'?o.selectedApplicantUid!==uid||o.ownerUid===uid:o.ownerUid!==uid))return fail();
   if(o.status!=='completed')continue;
   if(kind==='personal_requester'&&o.requesterStore!==undefined)continue;
   if(kind==='store_requester'&&o.requesterStore?.storeId!==store?.storeId)continue;
   const c=await readFreelanceReputationContext(tx,uid,doc.id),v=view(c);
   if(!v.received)continue;
   if(canonicalVariablePaymentRecord(v.received.subject)!==canonicalVariablePaymentRecord(subject))return fail();
   entries.push({offerId:doc.id,stars:v.received.stars,submittedAt:v.received.submittedAt,completedAt:c.parties.completedAt});
  }
  return {subject,entries,releasedCountOnPage:entries.length,nextCursor:docs.size>20?page.at(-1)!.id:null,rewardsGranted:false as const};
 },{readOnly:true});
}
