import type {Transaction,DocumentReference} from 'firebase-admin/firestore';
import {adminDb} from '../firebaseAdmin.js';
import {readAttendanceContext} from './freelanceAttendanceScheduleService.js';
import {readAttendanceTimeline} from './freelanceAttendanceService.js';
import {projectFreelanceAttendance,type FreelanceAttendanceSchedule,type FreelanceAttendanceEvent} from '../../shared/freelanceAttendance.js';
import {validateFreelanceExtensions} from '../../shared/freelanceHourlyAccounting.js';
import {readFreelanceExtensionProposal,decideFreelanceExtension,projectAcceptedFreelanceExtensions,type FreelanceExtensionProposal} from '../../shared/freelanceAttendanceExtensions.js';
import {validFreelanceId} from '../../shared/freelanceLifecycle.js';
import {FREELANCE_MAX_ESTIMATED_MINUTES} from '../../shared/freelanceWorkTerms.js';

const fail=():never=>{throw Error('FREELANCE_HOURLY_ACCOUNTING_CONFLICT');};
export async function readExtensionRecords(tx:Transaction,offerRef:DocumentReference,scheduleId:string,schedule:FreelanceAttendanceSchedule,events:readonly FreelanceAttendanceEvent[]){
 const ref=offerRef.collection('attendance').doc('extensions'),raw=(await tx.get(ref)).data();
 if(raw&&(Object.keys(raw).length!==2||raw.scheduleId!==scheduleId||!Array.isArray(raw.records)||raw.records.length>128))return fail();
 const records:FreelanceExtensionProposal[]=(raw?.records??[]).map(readFreelanceExtensionProposal);
 const ids=new Set<string>();let last=-Infinity;
 for(let i=0;i<records.length;i++){
  const r=records[i];
  if(ids.has(r.id)||Date.parse(r.proposedAt)<last||(r.status==='pending'&&i!==records.length-1))return fail();
  ids.add(r.id);last=Date.parse(r.decidedAt??r.proposedAt);
 }
 const authorizedMinutes=validateFreelanceExtensions(schedule,events,projectAcceptedFreelanceExtensions(records));
 return {ref,records,authorizedMinutes,last};
}
function eligible(status:string,projection:ReturnType<typeof projectFreelanceAttendance>,authorizedMinutes:number){
 return (status==='contracted'&&projection.status==='waiting'||status==='in_progress'&&['working','paused'].includes(projection.status))&&projection.elapsedCompensableMs<authorizedMinutes*60000;
}
export async function readFreelanceExtensions(uid:string,offerId:string){
 return adminDb.runTransaction(async tx=>{
  const c=await readAttendanceContext(tx,uid,offerId),t=await readAttendanceTimeline(tx,c);
  if(!t)return {actor:c.actor,eligible:false,records:[],sequence:0,authorizedMinutes:null,mode:c.terms?.mode??null};
  const e=await readExtensionRecords(tx,c.ref,t.scheduleId,t.schedule,t.events);
  const now=new Date().toISOString(),projection=projectFreelanceAttendance(t.schedule,t.events,now);
  return {actor:c.actor,eligible:eligible(c.offer.status,projection,e.authorizedMinutes)&&e.authorizedMinutes<FREELANCE_MAX_ESTIMATED_MINUTES,records:e.records,sequence:t.events.length,authorizedMinutes:e.authorizedMinutes,mode:c.terms?.mode??null};
 },{readOnly:true});
}
export async function changeFreelanceExtension(uid:string,offerId:string,action:'propose'|'accept'|'decline'|'withdraw',input:{proposalId:unknown;extraMinutes?:unknown;expectedSequence:unknown;confirmed:unknown}){
 if(input.confirmed!==true||!validFreelanceId(input.proposalId)||!Number.isSafeInteger(input.expectedSequence)||Number(input.expectedSequence)<0)throw Error('FREELANCE_INVALID');
 if(action==='propose'&&(!Number.isSafeInteger(input.extraMinutes)||Number(input.extraMinutes)<1||Number(input.extraMinutes)>FREELANCE_MAX_ESTIMATED_MINUTES))throw Error('FREELANCE_INVALID');
 return adminDb.runTransaction(async tx=>{
  const c=await readAttendanceContext(tx,uid,offerId),t=await readAttendanceTimeline(tx,c);
  if(!t)return fail();
  const e=await readExtensionRecords(tx,c.ref,t.scheduleId,t.schedule,t.events);
  const existing=e.records.find(r=>r.id===input.proposalId),current=e.records.at(-1);
  const now=new Date().toISOString();
  if(action==='propose'&&existing){
   if(existing.proposedBy===c.actor&&existing.extraMinutes===input.extraMinutes)return existing;return fail();
  }
  const decision=action==='accept'?'accepted':action==='decline'?'declined':'withdrawn';
  if(action!=='propose'&&existing?.status===decision&&existing.decidedBy===c.actor)return existing;
  if(t.events.length!==input.expectedSequence||Date.parse(now)<e.last||t.events.some(v=>v.at===now))return fail();
  const projection=projectFreelanceAttendance(t.schedule,t.events,now);
  let next:FreelanceExtensionProposal;
  let records:FreelanceExtensionProposal[];
  if(action==='propose'){
   if(!eligible(c.offer.status,projection,e.authorizedMinutes)||current?.status==='pending'||e.records.length>=128||Number(input.extraMinutes)>FREELANCE_MAX_ESTIMATED_MINUTES-e.authorizedMinutes||projectAcceptedFreelanceExtensions(e.records).length>=64)return fail();
   next=readFreelanceExtensionProposal({id:input.proposalId,extraMinutes:input.extraMinutes,proposedBy:c.actor,proposedAt:now,status:'pending'});
   records=[...e.records,next];
  }else{
   if(!current||current.id!==input.proposalId)return fail();
   if(action==='accept'&&(!eligible(c.offer.status,projection,e.authorizedMinutes)||t.events.some(v=>v.kind==='suspend'&&Date.parse(v.at)>=Date.parse(current.proposedAt))))return fail();
   next=decideFreelanceExtension(current,c.actor,decision,now);
   records=[...e.records.slice(0,-1),next];
  }
  validateFreelanceExtensions(t.schedule,t.events,projectAcceptedFreelanceExtensions(records));
  tx.set(e.ref,{scheduleId:t.scheduleId,records});
  return next;
 });
}
