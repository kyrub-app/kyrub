import {adminDb,getFirebaseAdminProjectId} from '../firebaseAdmin.js';
import {validFreelanceId} from '../../shared/freelanceLifecycle.js';
import type {FreelancePaymentObligation} from '../../shared/freelancePaymentObligation.js';
import {readFinancialContext,checkedReview} from './freelanceExternalPaymentStatementService.js';
import {assertFinancialCaseRestrictions} from './freelanceEngagementRestrictionService.js';

type EvidenceNote={id:string;actorUid:string;note:string;recordedAt:string};
const ref=(id:string)=>adminDb.doc('freelanceFinancialReviewsV1/'+id+'/evidence/notes');
const fail=():never=>{throw Error('FREELANCE_FINANCIAL_EVIDENCE_CONFLICT');};
function local(){
 if(process.env.VERCEL||process.env.VERCEL_ENV||process.env.FIREBASE_SERVICE_ACCOUNT_JSON||process.env.GOOGLE_APPLICATION_CREDENTIALS||
 !/^(127\.0\.0\.1|localhost):8088$/.test(process.env.FIRESTORE_EMULATOR_HOST??'')||
 getFirebaseAdminProjectId()!=='kyrub-security-test')throw Error('FREELANCE_DIRECT_PAYMENT_NOT_ENABLED');
}
// Plain textual context only, not a document upload, bank verification or public message.
function normalizeNote(v:unknown):string{
 if(typeof v!=='string')throw Error('FREELANCE_INVALID');
 const text=v.trim();
 if(text.length<10||text.length>500||/[\u0000-\u0008\u000b-\u001f\u007f]/.test(text)||
 /https?:\/\/|data:|www\./i.test(text))throw Error('FREELANCE_INVALID');
 return text;
}
export async function readFinancialEvidence(tx:FirebaseFirestore.Transaction,obligation:FreelancePaymentObligation,requestedAt:string){
 local();
 const raw=(await tx.get(ref(obligation.offerId))).data();
 if(!raw)return {revision:0,notes:[] as EvidenceNote[]};
 if(Object.keys(raw).length!==4||raw.schemaVersion!==1||raw.offerId!==obligation.offerId||
 !Array.isArray(raw.notes)||raw.notes.length<1||raw.notes.length>4||raw.revision!==raw.notes.length)return fail();
 const notes=raw.notes as EvidenceNote[],ids=new Set<string>(),counts=new Map<string,number>();
 let prior=Date.parse(requestedAt);
 for(const n of notes){
  if(!n||Object.keys(n).length!==4||!validFreelanceId(n.id)||ids.has(n.id)||
   ![obligation.requesterUid,obligation.beneficiaryUid].includes(n.actorUid)||
   !Number.isFinite(Date.parse(n.recordedAt))||Date.parse(n.recordedAt)<prior)return fail();
  try{if(normalizeNote(n.note)!==n.note)return fail();}catch{return fail();}
  ids.add(n.id);prior=Date.parse(n.recordedAt);
  const count=(counts.get(n.actorUid)??0)+1;if(count>2)return fail();counts.set(n.actorUid,count);
 }
 return {revision:raw.revision as number,notes};
}
/** Participant may add private context after escalation. No raw receipt bytes,
 * external URLs, client-generated actor/time, or access for the counterparty yet.
 */
export async function submitFreelanceFinancialEvidence(uid:string,offerId:string,input:unknown){
 local();
 if(!validFreelanceId(uid)||!validFreelanceId(offerId)||!input||typeof input!=='object'||Array.isArray(input))throw Error('FREELANCE_INVALID');
 const b=input as Record<string,unknown>;
 if(Object.keys(b).length!==3||!validFreelanceId(b.evidenceId)||b.confirmed!==true)throw Error('FREELANCE_INVALID');
 const note=normalizeNote(b.note),id=b.evidenceId;
 return adminDb.runTransaction(async tx=>{
  const queue=await tx.get(adminDb.doc('freelanceFinancialReviewsV1/'+offerId));
  const {obligation,projection}=await readFinancialContext(tx,uid,offerId);
  const review=checkedReview(queue.data(),obligation);
  if(!review||review.status!=='pending'||projection.state!=='disputed')return fail();
  await assertFinancialCaseRestrictions(tx,obligation);
  const saved=await readFinancialEvidence(tx,obligation,review.requestedAt),existing=saved.notes.find(n=>n.id===id);
  if(existing){
   if(existing.actorUid!==uid||existing.note!==note)return fail();
   return {created:false,revision:saved.revision};
  }
  if(saved.notes.filter(n=>n.actorUid===uid).length>=2)return fail();
  const recordedAt=new Date().toISOString();
  if(Date.parse(recordedAt)<Date.parse(saved.notes.at(-1)?.recordedAt??review.requestedAt))return fail();
  tx.set(ref(offerId),{schemaVersion:1,offerId,revision:saved.revision+1,notes:[...saved.notes,{id,actorUid:uid,note,recordedAt}]});
  return {created:true,revision:saved.revision+1};
 });
}
