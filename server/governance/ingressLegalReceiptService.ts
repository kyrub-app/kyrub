import {createHash} from 'node:crypto';
import {FieldValue,type Transaction} from 'firebase-admin/firestore';
import {adminAuth,adminDb,getFirebaseAdminProjectId} from '../firebaseAdmin.js';
import {ageScreeningEmulatorsReady} from '../identity/ageScreeningRouter.js';
import {projectPublicLegalDocument,type PublicLegalDocument} from './publicLegalDocumentPolicy.js';
import type {GovernanceDocument} from '../../shared/governance.js';

type Reference=Pick<PublicLegalDocument,'id'|'version'|'hash'>;
type Decision={terms:Reference&{accepted:true};privacy:Reference&{acknowledged:true}};
const digest=(s:string)=>createHash('sha256').update(s,'utf8').digest('hex');
function validReference(value:unknown,flag:'accepted'|'acknowledged'){
 if(!value||typeof value!=='object'||Array.isArray(value))return false;
 const v=value as Record<string,unknown>;
 return Object.keys(v).length===4&&v[flag]===true&&typeof v.id==='string'&&v.id.length>0&&v.id.length<=128&&typeof v.version==='string'&&v.version.length>0&&v.version.length<=128&&typeof v.hash==='string'&&/^[a-f0-9]{64}$/.test(v.hash);
}
const matches=(a:Reference,b:PublicLegalDocument)=>a.id===b.id&&a.version===b.version&&a.hash===b.hash;

async function currentIngressDocuments(tx:Transaction){
  const query=adminDb.collection('governanceDocuments').where('status','==','published');
  const [termsSnap,privacySnap]=await Promise.all([tx.get(query.where('type','==','terms').limit(2)),tx.get(query.where('type','==','privacy').limit(2))]);
  function project(snap:typeof termsSnap,type:PublicLegalDocument['type']){
   if(snap.size!==1)return null;
   const doc=snap.docs[0],data=doc.data() as GovernanceDocument&{content?:unknown};
   if(data.id!==doc.id||typeof data.publishedAt!=='string'||Date.parse(data.publishedAt)>Date.now())return null;
   return projectPublicLegalDocument([data],type);
  }
  const terms=project(termsSnap,'terms'),privacy=project(privacySnap,'privacy');
  if(!terms||!privacy)throw Error('LEGAL_DOCUMENTS_UNAVAILABLE');
  return {terms,privacy};
}
function receiptReference(uid:string,terms:PublicLegalDocument,privacy:PublicLegalDocument){
 const receiptId=digest(JSON.stringify([uid,terms.id,terms.version,terms.hash,privacy.id,privacy.version,privacy.hash]));
 return {receiptId,ref:adminDb.collection('ingress_legal_receipts_private').doc(receiptId)};
}
/** Read the current pair and its matching receipt inside the caller's transaction. */
export async function requireCurrentIngressLegalReceiptInTransaction(tx:Transaction,uid:string){
 if(!/^[A-Za-z0-9_-]{1,128}$/.test(uid))throw Error('LEGAL_AUTH_REQUIRED');
 const {terms,privacy}=await currentIngressDocuments(tx);
 const {receiptId,ref}=receiptReference(uid,terms,privacy);
 const saved=await tx.get(ref);
 if(!saved.exists)throw Error('LEGAL_CURRENT_RECEIPT_REQUIRED');
 if(saved.get('uid')!==uid||saved.get('receiptId')!==receiptId||saved.get('terms.accepted')!==true||saved.get('privacy.acknowledged')!==true||!saved.get('terms')||!saved.get('privacy')||!matches(saved.get('terms'),terms)||!matches(saved.get('privacy'),privacy)||!saved.get('recordedAt'))throw Error('LEGAL_RECEIPT_INVALID');
 return receiptId;
}

/** Candidate only: no legal publication authority and no production endpoint. */
export async function recordIngressLegalReceipt(authorization:string,input:unknown){
 const uid=await authenticateLegalPreview(authorization);
 if(!input||typeof input!=='object'||Array.isArray(input)||Object.keys(input).length!==2)throw Error('LEGAL_DECISION_INVALID');
 const decision=input as Decision;
 if(!validReference(decision.terms,'accepted')||!validReference(decision.privacy,'acknowledged'))throw Error('LEGAL_DECISION_INVALID');
 return adminDb.runTransaction(async tx=>{
  const {terms,privacy}=await currentIngressDocuments(tx);
  if(!matches(decision.terms,terms)||!matches(decision.privacy,privacy))throw Error('LEGAL_VERSION_CHANGED');
  const {receiptId,ref}=receiptReference(uid,terms,privacy);
  const existing=await tx.get(ref);
  if(existing.exists){
   if(existing.get('uid')!==uid||existing.get('receiptId')!==receiptId||existing.get('terms.accepted')!==true||existing.get('privacy.acknowledged')!==true||!matches(existing.get('terms'),terms)||!matches(existing.get('privacy'),privacy)||!existing.get('recordedAt'))throw Error('LEGAL_RECEIPT_INVALID');
   return {receiptId,replay:true};
  }
  tx.create(ref,{receiptId,uid,terms:{id:terms.id,version:terms.version,hash:terms.hash,accepted:true},privacy:{id:privacy.id,version:privacy.version,hash:privacy.hash,acknowledged:true},recordedAt:FieldValue.serverTimestamp()});
  return {receiptId,replay:false};
 });
}

async function authenticateLegalPreview(authorization:string){
 if(!ageScreeningEmulatorsReady(process.env)||getFirebaseAdminProjectId()!=='demo-kyrub-onboarding'||process.env.KYRUB_LEGAL_RECEIPT_PREVIEW_ENABLED!=='true')throw Error('LEGAL_RECEIPT_UNAVAILABLE');
 const token=/^Bearer ([^\s]+)$/i.exec(authorization)?.[1];
 if(!token||token.length>8192)throw Error('LEGAL_AUTH_REQUIRED');
 const actor=await adminAuth.verifyIdToken(token,true);
 const uid=actor.uid;
 if(actor.email_verified!==true||!/^[A-Za-z0-9_-]{1,128}$/.test(uid))throw Error('LEGAL_AUTH_REQUIRED');
 return uid;
}

/** Return only canonical public text and the caller's own acceptance status. */
export async function readOwnIngressLegalReceipt(authorization:string){
 const uid=await authenticateLegalPreview(authorization);
 return adminDb.runTransaction(async tx=>{
  const {terms,privacy}=await currentIngressDocuments(tx);
  const {receiptId,ref}=receiptReference(uid,terms,privacy);
  const saved=await tx.get(ref);
  if(saved.exists&&(saved.get('uid')!==uid||saved.get('receiptId')!==receiptId||saved.get('terms.accepted')!==true||saved.get('privacy.acknowledged')!==true||!matches(saved.get('terms'),terms)||!matches(saved.get('privacy'),privacy)||!saved.get('recordedAt')))throw Error('LEGAL_RECEIPT_INVALID');
  return {terms,privacy,accepted:saved.exists};
 });
}
