// Local emulator only. Fixture credentials must be seeded by the test harness.
// No public issuer, real Control Plane role binding, retention hold, raw logs or disclosure.
import {getApps,initializeApp} from 'firebase-admin/app';
import {getFirestore,type Transaction,type DocumentSnapshot} from 'firebase-admin/firestore';
import {createHash,timingSafeEqual,randomUUID} from 'node:crypto';
import {assertCidSosEmulator,CID_EMULATOR_PROJECT} from './cidSosEmulatorStore.js';
import {isTagId} from '../../shared/kyrubTagContract.js';
import {CID_REVIEW_DISPOSITIONS,type CidReviewQueueItem,type CidReviewDetail,type CidReviewInput} from '../../shared/cidEvidenceReview.js';
import {CID_COMPLAINT_CATEGORIES} from '../../shared/cidOccurrenceComplaint.js';
const APP='cid-evidence-review-local-emulator';
const deny=():never=>{throw Error('CID_REVIEW_FORBIDDEN');};
const token=(v:unknown):v is string=>typeof v==='string'&&/^[A-Za-z0-9_-]{43}$/.test(v);
const uuid=(v:unknown):v is string=>typeof v==='string'&&/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/.test(v);
const time=(v:unknown):v is number=>typeof v==='number'&&Number.isSafeInteger(v)&&v>0;
const hash=(v:string)=>createHash('sha256').update(v).digest('hex');
const text=(v:unknown):v is string=>typeof v==='string'&&v.length>0&&v.length<=500;
type Credential={id:string;secret:string};
function reason(value:unknown){
 if(typeof value!=='string'||value.length>1000)return deny();
 const v=value.trim().normalize('NFC');
 if(!text(v)||/[\u0000-\u0008\u000b-\u001f\u007f-\u009f\u202a-\u202e\u2066-\u2069]/.test(v))return deny();return v;
}
function item(doc:DocumentSnapshot,now:number):CidReviewQueueItem{
 const v=doc.data(),revision=v?.revision??0;
 if(!v||!uuid(doc.id)||v.id!==doc.id||!isTagId(v.tagId)||typeof v.occurrenceId!=='string'||!/^[A-Za-z0-9_-]{22,80}$/.test(v.occurrenceId)||!time(v.createdAt)||v.createdAt>now||v.simulation!==true||!['complaint','preservation'].includes(v.kind)||!['pending-review','dismissed','escalated'].includes(v.status)||!Number.isSafeInteger(revision)||revision<0)return deny();
 return {id:doc.id,kind:v.kind,tagId:v.tagId,occurrenceId:v.occurrenceId,createdAt:v.createdAt,status:v.status,revision};
}
export function createCidEvidenceReviewEmulator(){
 assertCidSosEmulator();
 const app=getApps().find(a=>a.name===APP)??initializeApp({projectId:CID_EMULATOR_PROJECT},APP);
 if(app.options.projectId!==CID_EMULATOR_PROJECT)return deny();
 const db=getFirestore(app),queue=db.collection('cid_sos_emulator_review_queue'),audit=db.collection('cid_sos_emulator_review_audit');
 async function authorize(tx:Transaction,credential:Credential,now:number,permission:'review:read'|'review:decide'){
  assertCidSosEmulator();if(!time(now)||!credential||!token(credential.id)||!token(credential.secret))return deny();
  const session=(await tx.get(db.collection('cid_sos_emulator_review_sessions').doc(credential.id))).data();
  if(!session||session.id!==credential.id||session.simulation!==true||session.revokedAt!==undefined||session.role!=='evidence-officer'||typeof session.actorId!=='string'||!/^[A-Za-z0-9_-]{1,128}$/.test(session.actorId)||!time(session.authenticatedAt)||!time(session.expiresAt)||now<session.authenticatedAt||now>=session.expiresAt||session.expiresAt-session.authenticatedAt>30*60000||!Array.isArray(session.permissions)||!session.permissions.includes(permission)||typeof session.digest!=='string'||!/^[a-f0-9]{64}$/.test(session.digest)||!timingSafeEqual(Buffer.from(session.digest,'hex'),Buffer.from(hash(credential.secret),'hex')))return deny();
  const grant=(await tx.get(db.collection('cid_sos_emulator_review_operators').doc(session.actorId))).data();
  if(!grant||grant.active!==true||grant.role!=='evidence-officer'||!Array.isArray(grant.permissions)||!grant.permissions.includes(permission))return deny();
  if(permission==='review:decide'&&now-session.authenticatedAt>5*60000)return deny();
  return session.actorId as string;
 }
 function record(tx:Transaction,actorId:string,action:string,now:number,fields:Record<string,unknown>={}){
  const id=randomUUID();tx.create(audit.doc(id),{id,actorId,action,createdAt:now,simulation:true,...fields});
 }
 async function detail(tx:Transaction,i:CidReviewQueueItem):Promise<CidReviewDetail>{
  const occurrence=db.collection('cid_sos_emulator_tags').doc(i.tagId).collection('occurrences').doc(i.occurrenceId);
  const state=occurrence.collection('chat').doc('state');
  const o=await tx.get(occurrence);
  if(!o.exists||o.get('id')!==i.occurrenceId||o.get('tagId')!==i.tagId)return deny();
  if(i.kind==='preservation'){
   const d=await tx.get(state.collection('private').doc('preservation-request')),r=d.get('request');
   if(d.get('simulation')!==true||d.get('tagId')!==i.tagId||r?.id!==i.id||r.occurrenceId!==i.occurrenceId||r.status!=='pending-review'||!text(r.reason))return deny();
   return {item:i,reason:r.reason};
  }
  const q=await tx.get(state.collection('complaints').where('id','==',i.id).limit(2));
  if(q.size!==1)return deny();
  const v=q.docs[0].data();
  if(v.simulation!==true||v.id!==i.id||v.tagId!==i.tagId||v.occurrenceId!==i.occurrenceId||v.status!=='pending-review'||!text(v.reason)||!Object.hasOwn(CID_COMPLAINT_CATEGORIES,v.category)||!['owner','emitter','contact'].includes(v.reporterRole))return deny();
  return {item:i,reason:v.reason,category:v.category,reporterRole:v.reporterRole};
 }
 return {
  async list(credential:Credential,now:number){
   return db.runTransaction(async tx=>{
    const actor=await authorize(tx,credential,now,'review:read');
    const rows=await tx.get(queue.orderBy('createdAt','desc').limit(51));
    const items=rows.docs.slice(0,50).map(d=>item(d,now));
    record(tx,actor,'list',now,{count:items.length});return {items,hasMore:rows.size>50};
   });
  },
  async detail(credential:Credential,id:string,now:number){
   if(!uuid(id))return deny();return db.runTransaction(async tx=>{
    const actor=await authorize(tx,credential,now,'review:read'),i=item(await tx.get(queue.doc(id)),now);
    const result=await detail(tx,i);
    record(tx,actor,'detail',now,{caseId:id});return result;
   });
  },
  async decide(credential:Credential,input:unknown,now:number){
   if(!input||typeof input!=='object'||Array.isArray(input))return deny();
   const v=input as CidReviewInput;
   if(Object.keys(v).length!==4||Object.keys(v).some(k=>!['id','expectedRevision','disposition','reason'].includes(k))||!uuid(v.id)||!Number.isSafeInteger(v.expectedRevision)||v.expectedRevision<0||!Object.hasOwn(CID_REVIEW_DISPOSITIONS,v.disposition))return deny();
   const justification=reason(v.reason);
   return db.runTransaction(async tx=>{
    const actor=await authorize(tx,credential,now,'review:decide'),ref=queue.doc(v.id),i=item(await tx.get(ref),now);
    if(i.status!=='pending-review'||i.revision!==v.expectedRevision)return deny();
    await detail(tx,i);
    const revision=i.revision+1;
    tx.update(ref,{status:v.disposition,revision,reviewedAt:now});
    record(tx,actor,'triage-decision',now,{caseId:i.id,previousStatus:i.status,status:v.disposition,revision,reason:justification});
    // Escalation ONLY routes a case for specialist review. It does not approve preservation or disclosure.
    return {revision,status:v.disposition};
   });
  }
 };
}
