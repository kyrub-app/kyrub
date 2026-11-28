import {assertEngagementPilotAuthority,assertContractPilotTerms,freelanceContractPilotEnabled} from './freelanceEngagementPilotAuthority.js';
import {adminDb,getFirebaseAdminProjectId} from '../firebaseAdmin.js';
import {validFreelanceId} from '../../shared/freelanceLifecycle.js';
import type {FreelancePaymentObligation} from '../../shared/freelancePaymentObligation.js';
import {readFinancialContext,checkedReview} from './freelanceExternalPaymentStatementService.js';
import {assertFinancialCaseRestrictions} from './freelanceEngagementRestrictionService.js';
import {sanitizeReceiptPng,MAX_RECEIPT_BYTES} from './freelanceReceiptPng.js';
import {createHash} from 'node:crypto';

type Receipt={id:string;actorUid:string;recordedAt:string;size:number;width:number;height:number;sha256:string};
const fail=():never=>{throw Error('FREELANCE_FINANCIAL_EVIDENCE_CONFLICT');};
const manifest=(id:string)=>adminDb.doc('freelanceFinancialReviewsV1/'+id+'/evidence/receipts');
const fileRef=(id:string,receiptId:string)=>manifest(id).collection('files').doc(receiptId);
function evidenceAuthority(obligation:FreelancePaymentObligation,pilot:boolean){
 if(!pilot){local();return;}
 if(!freelanceContractPilotEnabled())throw Error('FREELANCE_DIRECT_PAYMENT_NOT_ENABLED');
 assertEngagementPilotAuthority(obligation.requesterUid);
 assertEngagementPilotAuthority(obligation.beneficiaryUid);
}
function local(){
 if(process.env.VERCEL||process.env.VERCEL_ENV||process.env.FIREBASE_SERVICE_ACCOUNT_JSON||process.env.GOOGLE_APPLICATION_CREDENTIALS||
 !/^(127\.0\.0\.1|localhost):8088$/.test(process.env.FIRESTORE_EMULATOR_HOST??'')||getFirebaseAdminProjectId()!=='kyrub-security-test')throw Error('FREELANCE_DIRECT_PAYMENT_NOT_ENABLED');
}
export async function readFinancialReceiptManifest(tx:FirebaseFirestore.Transaction,obligation:FreelancePaymentObligation,requestedAt:string,pilot=false){
 evidenceAuthority(obligation,pilot);
 const raw=(await tx.get(manifest(obligation.offerId))).data();
 if(!raw)return {revision:0,receipts:[] as Receipt[]};
 if(Object.keys(raw).length!==4||raw.schemaVersion!==1||raw.offerId!==obligation.offerId||!Array.isArray(raw.receipts)||
 raw.receipts.length<1||raw.receipts.length>2||raw.revision!==raw.receipts.length)return fail();
 const receipts=raw.receipts as Receipt[],ids=new Set<string>(),actors=new Set<string>();
 let prior=Date.parse(requestedAt);
 for(const r of receipts){
  if(!r||Object.keys(r).length!==7||!validFreelanceId(r.id)||ids.has(r.id)||actors.has(r.actorUid)||
   ![obligation.requesterUid,obligation.beneficiaryUid].includes(r.actorUid)||
   !Number.isFinite(Date.parse(r.recordedAt))||Date.parse(r.recordedAt)<prior||
   !Number.isSafeInteger(r.size)||r.size<1||r.size>MAX_RECEIPT_BYTES||
   !Number.isSafeInteger(r.width)||r.width<1||r.width>2048||!Number.isSafeInteger(r.height)||r.height<1||r.height>4096||
   r.width*r.height>4_000_000||typeof r.sha256!=='string'||!/^[a-f0-9]{64}$/.test(r.sha256))return fail();
  ids.add(r.id);actors.add(r.actorUid);prior=Date.parse(r.recordedAt);
 }
 return {revision:raw.revision as number,receipts};
}
/** Emulator-only prototype: private bytes in a separate server-only Firestore
 * document. No Storage bucket, public URL, filename, or real user data.
 */
export async function submitFreelanceFinancialReceipt(uid:string,offerId:string,input:unknown,pilot=false){
 if(pilot){assertEngagementPilotAuthority(uid);if(!freelanceContractPilotEnabled())throw Error('FREELANCE_DIRECT_PAYMENT_NOT_ENABLED');}else local();
 if(!validFreelanceId(uid)||!validFreelanceId(offerId)||!input||typeof input!=='object'||Array.isArray(input))throw Error('FREELANCE_INVALID');
 const b=input as Record<string,unknown>;
 if(Object.keys(b).length!==3||!validFreelanceId(b.receiptId)||b.confirmed!==true)throw Error('FREELANCE_INVALID');
 const id=b.receiptId,clean=sanitizeReceiptPng(b.pngBase64);
 return adminDb.runTransaction(async tx=>{
  const queue=await tx.get(adminDb.doc('freelanceFinancialReviewsV1/'+offerId));
  const {offer,obligation,projection}=await readFinancialContext(tx,uid,offerId);
  if(pilot){assertContractPilotTerms(offer);evidenceAuthority(obligation,true);}
  const review=checkedReview(queue.data(),obligation);
  if(!review||review.status!=='pending'||projection.state!=='disputed')return fail();
  await assertFinancialCaseRestrictions(tx,obligation);
  const saved=await readFinancialReceiptManifest(tx,obligation,review.requestedAt,pilot);
  const existing=saved.receipts.find(r=>r.id===id);
  const file=await tx.get(fileRef(offerId,id));
  if(existing){
   if(existing.actorUid!==uid||existing.sha256!==clean.sha256||!file.exists)return fail();
   await verifyReceiptBytes(file.data(),existing);
   return {created:false,revision:saved.revision};
  }
  if(file.exists||saved.receipts.some(r=>r.actorUid===uid))return fail();
  const recordedAt=new Date().toISOString();
  if(Date.parse(recordedAt)<Date.parse(saved.receipts.at(-1)?.recordedAt??review.requestedAt))return fail();
  const item:Receipt={id,actorUid:uid,recordedAt,size:clean.bytes.length,width:clean.width,height:clean.height,sha256:clean.sha256};
  tx.create(fileRef(offerId,id),{schemaVersion:1,sha256:item.sha256,pngBase64:clean.bytes.toString('base64')});
  tx.set(manifest(offerId),{schemaVersion:1,offerId,revision:saved.revision+1,receipts:[...saved.receipts,item]});
  return {created:true,revision:saved.revision+1};
 });
}
async function verifyReceiptBytes(raw:FirebaseFirestore.DocumentData|undefined,item:Receipt){
 if(!raw||Object.keys(raw).length!==3||raw.schemaVersion!==1||raw.sha256!==item.sha256||typeof raw.pngBase64!=='string')return fail();
 const bytes=Buffer.from(raw.pngBase64,'base64');
 if(bytes.length!==item.size||bytes.toString('base64')!==raw.pngBase64||createHash('sha256').update(bytes).digest('hex')!==item.sha256)return fail();
 const clean=sanitizeReceiptPng(raw.pngBase64);
 if(clean.sha256!==item.sha256||clean.width!==item.width||clean.height!==item.height)return fail();
 return raw.pngBase64 as string;
}
/** Call only inside authorized administrator read transaction. */
export async function readFinancialReceiptBytes(tx:FirebaseFirestore.Transaction,obligation:FreelancePaymentObligation,requestedAt:string,id:string,pilot=false){
 evidenceAuthority(obligation,pilot);if(!validFreelanceId(id))throw Error('FREELANCE_INVALID');
 const {receipts}=await readFinancialReceiptManifest(tx,obligation,requestedAt,pilot),item=receipts.find(r=>r.id===id);
 if(!item)throw Error('FREELANCE_FORBIDDEN');
 return {id,mimeType:'image/png' as const,pngBase64:await verifyReceiptBytes((await tx.get(fileRef(obligation.offerId,id))).data(),item),bankVerified:false as const};
}
