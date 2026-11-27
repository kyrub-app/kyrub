import {sanitizeReceiptPng,MAX_RECEIPT_BYTES} from './freelanceReceiptPng.js';
import type {Transaction,DocumentReference} from 'firebase-admin/firestore';
import {validFreelanceId} from '../../shared/freelanceLifecycle.js';
import {digestVariablePaymentSources} from './freelanceVariablePaymentBasisService.js';
export type HourlyReviewKind='cancellation'|'excess'|'fixed_cancellation'|'fixed_adjustment';
type Party={offerId:string;requesterUid:string;beneficiaryUid:string};
type Note={id:string;actorUid:string;note:string;recordedAt:string};
const fail=():never=>{throw Error('FREELANCE_FINANCIAL_EVIDENCE_CONFLICT');};
export function normalizeHourlyReviewNote(v:unknown){
 if(typeof v!=='string')throw Error('FREELANCE_INVALID');
 const text=v.trim();
 if(text.length<10||text.length>500||/[\u0000-\u0008\u000b-\u001f\u007f]/.test(text)||/https?:\/\/|data:|www\./i.test(text))throw Error('FREELANCE_INVALID');
 return text;
}
export async function readHourlyReviewNotes(tx:Transaction,queueRef:DocumentReference,p:Party,sourceDigest:string,requestedAt:string|undefined){
 const ref=queueRef.collection('evidence').doc('notes'),raw=(await tx.get(ref)).data();
 let notes:Note[]=[];
 if(raw){
  if(!requestedAt||Object.keys(raw).length!==6||raw.schemaVersion!==1||raw.offerId!==p.offerId||raw.sourceDigest!==sourceDigest||raw.requestedAt!==requestedAt||!Array.isArray(raw.notes)||raw.notes.length<1||raw.notes.length>4||raw.revision!==raw.notes.length)return fail();
  notes=raw.notes as Note[];
  const ids=new Set<string>(),counts=new Map<string,number>();let prior=Date.parse(requestedAt);
  for(const n of notes){
   if(!n||Object.keys(n).length!==4||!validFreelanceId(n.id)||ids.has(n.id)||![p.requesterUid,p.beneficiaryUid].includes(n.actorUid)||!Number.isFinite(Date.parse(n.recordedAt))||new Date(Date.parse(n.recordedAt)).toISOString()!==n.recordedAt||Date.parse(n.recordedAt)<prior)return fail();
   try{if(normalizeHourlyReviewNote(n.note)!==n.note)return fail();}catch{return fail();}
   ids.add(n.id);prior=Date.parse(n.recordedAt);const count=(counts.get(n.actorUid)??0)+1;if(count>2)return fail();counts.set(n.actorUid,count);
  }
 }
 const manifest=queueRef.collection('evidence').doc('attachments'),saved=(await tx.get(manifest)).data();
 let attachments:Attachment[]=[];
 if(saved){
  if(!requestedAt||Object.keys(saved).length!==6||saved.schemaVersion!==1||saved.offerId!==p.offerId||saved.sourceDigest!==sourceDigest||saved.requestedAt!==requestedAt||!Array.isArray(saved.attachments)||saved.attachments.length<1||saved.attachments.length>2||saved.revision!==saved.attachments.length)return fail();
  attachments=saved.attachments;
  const ids=new Set<string>(),actors=new Set<string>();let prior=Date.parse(requestedAt);
  for(const a of attachments){
   if(!a||Object.keys(a).length!==7||!validFreelanceId(a.id)||ids.has(a.id)||actors.has(a.actorUid)||![p.requesterUid,p.beneficiaryUid].includes(a.actorUid)||!Number.isFinite(Date.parse(a.recordedAt))||Date.parse(a.recordedAt)<prior||!Number.isSafeInteger(a.size)||a.size<1||a.size>MAX_RECEIPT_BYTES||!Number.isSafeInteger(a.width)||!Number.isSafeInteger(a.height)||a.width<1||a.width>2048||a.height<1||a.height>4096||a.width*a.height>4000000||typeof a.sha256!=='string'||!/^[a-f0-9]{64}$/.test(a.sha256))return fail();
   ids.add(a.id);actors.add(a.actorUid);prior=Date.parse(a.recordedAt);
  }
 }
 // Preserve the digest of note-only cases. Attachments extend the exact snapshot.
 return {ref,notes,manifest,attachments,digest:digestVariablePaymentSources({sourceDigest,requestedAt:requestedAt??null,notes,...(attachments.length?{attachments}:{})})};
}
export function projectHourlyReviewNotes(notes:Note[],p:Party,uid?:string){
 return notes.filter(n=>uid===undefined||n.actorUid===uid).map(n=>({id:n.id,role:n.actorUid===p.requesterUid?'requester':'worker',note:n.note,recordedAt:n.recordedAt}));
}
export function appendHourlyReviewNote(tx:Transaction,saved:Awaited<ReturnType<typeof readHourlyReviewNotes>>,p:Party,sourceDigest:string,requestedAt:string,uid:string,id:string,note:string){
 if(![p.requesterUid,p.beneficiaryUid].includes(uid))throw Error('FREELANCE_FORBIDDEN');
 const existing=saved.notes.find(n=>n.id===id);
 if(existing){if(existing.actorUid!==uid||existing.note!==note)return fail();return {changed:false};}
 if(saved.notes.filter(n=>n.actorUid===uid).length>=2)return fail();
 const recordedAt=new Date().toISOString();
 if(Date.parse(recordedAt)<Date.parse(saved.notes.at(-1)?.recordedAt??requestedAt))return fail();
 tx.set(saved.ref,{schemaVersion:1,offerId:p.offerId,sourceDigest,requestedAt,revision:saved.notes.length+1,notes:[...saved.notes,{id,actorUid:uid,note,recordedAt}]});
 return {changed:true};
}

type Attachment={id:string;actorUid:string;recordedAt:string;size:number;width:number;height:number;sha256:string};
type Evidence=Awaited<ReturnType<typeof readHourlyReviewNotes>>;
export function projectHourlyAttachments(items:Attachment[],p:Party,uid?:string){
 return items.filter(a=>uid===undefined||a.actorUid===uid).map(a=>({id:a.id,role:a.actorUid===p.requesterUid?'requester':'worker',recordedAt:a.recordedAt,size:a.size,mimeType:'image/png' as const}));
}
export async function readHourlyAttachment(tx:Transaction,saved:Evidence,id:string,uid?:string){
 const item=saved.attachments.find(a=>a.id===id&&(uid===undefined||uid===a.actorUid));
 if(!item)throw Error('FREELANCE_FORBIDDEN');
 const raw=(await tx.get(saved.manifest.collection('files').doc(id))).data();
 if(!raw||Object.keys(raw).length!==3||raw.schemaVersion!==1||raw.sha256!==item.sha256||typeof raw.pngBase64!=='string')return fail();
 const clean=sanitizeReceiptPng(raw.pngBase64);
 if(clean.sha256!==item.sha256||clean.bytes.length!==item.size||clean.width!==item.width||clean.height!==item.height||clean.bytes.toString('base64')!==raw.pngBase64)return fail();
 return {id,mimeType:'image/png' as const,pngBase64:raw.pngBase64,bankVerified:false as const};
}
export async function appendHourlyAttachment(tx:Transaction,saved:Evidence,p:Party,sourceDigest:string,requestedAt:string,uid:string,id:string,clean:ReturnType<typeof sanitizeReceiptPng>){
 if(![p.requesterUid,p.beneficiaryUid].includes(uid))throw Error('FREELANCE_FORBIDDEN');
 const existing=saved.attachments.find(a=>a.id===id),ref=saved.manifest.collection('files').doc(id);
 if(existing){if(existing.actorUid!==uid||existing.sha256!==clean.sha256)return fail();await readHourlyAttachment(tx,saved,id,uid);return {changed:false};}
 if(saved.attachments.some(a=>a.actorUid===uid)||(await tx.get(ref)).exists)return fail();
 const recordedAt=new Date().toISOString();
 if(Date.parse(recordedAt)<Date.parse(saved.attachments.at(-1)?.recordedAt??requestedAt))return fail();
 const item:Attachment={id,actorUid:uid,recordedAt,size:clean.bytes.length,width:clean.width,height:clean.height,sha256:clean.sha256};
 tx.create(ref,{schemaVersion:1,sha256:item.sha256,pngBase64:clean.bytes.toString('base64')});
 tx.set(saved.manifest,{schemaVersion:1,offerId:p.offerId,sourceDigest,requestedAt,revision:saved.attachments.length+1,attachments:[...saved.attachments,item]});
 return {changed:true};
}
