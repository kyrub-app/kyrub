import type {Transaction,DocumentReference} from 'firebase-admin/firestore';
import {validFreelanceId} from '../../shared/freelanceLifecycle.js';
import {digestVariablePaymentSources} from './freelanceVariablePaymentBasisService.js';
export type HourlyReviewKind='cancellation'|'excess';
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
 return {ref,notes,digest:digestVariablePaymentSources({sourceDigest,requestedAt:requestedAt??null,notes})};
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
