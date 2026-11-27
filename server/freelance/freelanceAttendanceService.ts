import {readExtensionRecords} from './freelanceAttendanceExtensionService.js';
import {projectAcceptedFreelanceExtensions} from '../../shared/freelanceAttendanceExtensions.js';
import {validateFreelanceExtensions} from '../../shared/freelanceHourlyAccounting.js';
import {createHash} from 'node:crypto';
import type {Transaction} from 'firebase-admin/firestore';
import {adminDb} from '../firebaseAdmin.js';
import {validFreelanceId} from '../../shared/freelanceLifecycle.js';
import {projectFreelanceAttendance,type FreelanceAttendanceEvent,type FreelanceAttendanceKind} from '../../shared/freelanceAttendance.js';
import {readAttendanceContext} from './freelanceAttendanceScheduleService.js';

type Context=Awaited<ReturnType<typeof readAttendanceContext>>;
const fail=():never=>{throw Error('FREELANCE_ATTENDANCE_CONFLICT');};
const manualKinds=['check_in','confirm_presence','authorize_early_start','acknowledge_waiting','request_break','approve_break','resume'] as const;
type ManualKind=typeof manualKinds[number];
const beforeStart=['check_in','confirm_presence','authorize_early_start','acknowledge_waiting'];
export async function readAttendanceTimeline(tx:Transaction,c:Context){
 const ref=c.ref.collection('attendance').doc('timeline');
 const raw=(await tx.get(ref)).data();
 if(c.current?.status!=='accepted'){if(raw)return fail();return null;}
 const events:FreelanceAttendanceEvent[]=raw?.events??[];
 if(raw&&(Object.keys(raw).length!==2||raw.scheduleId!==c.current.id||!Array.isArray(raw.events)))return fail();
 const projection=projectFreelanceAttendance(c.current.schedule,events);
 if(events.some(e=>Date.parse(e.at)<Date.parse(c.current!.decidedAt!)))return fail();
 return {ref,events,projection,schedule:c.current.schedule,scheduleId:c.current.id};
}
type Timeline=NonNullable<Awaited<ReturnType<typeof readAttendanceTimeline>>>;
async function append(tx:Transaction,t:Timeline,event:FreelanceAttendanceEvent){
 const old=t.events.find(e=>e.id===event.id);
 if(old){if(old.kind!==event.kind||old.actor!==event.actor)return fail();return ()=>{};}
 const ext=await readExtensionRecords(tx,t.ref.parent.parent!,t.scheduleId,t.schedule,t.events);
 if(Date.parse(event.at)<=ext.last)return fail();
 const events=[...t.events,event];
 projectFreelanceAttendance(t.schedule,events);
 validateFreelanceExtensions(t.schedule,events,projectAcceptedFreelanceExtensions(ext.records));
 return ()=>tx.set(t.ref,{scheduleId:t.scheduleId,events});
}
export async function readFreelanceAttendance(uid:string,offerId:string){
 return adminDb.runTransaction(async tx=>{
  const c=await readAttendanceContext(tx,uid,offerId),t=await readAttendanceTimeline(tx,c);
  return {actor:c.actor,operationalStatus:c.offer.status,schedule:c.current?.status==='accepted'?c.current.schedule:null,events:t?.events??[],projection:t?.projection??null};
 },{readOnly:true});
}
export async function recordFreelanceAttendance(uid:string,offerId:string,input:{kind:unknown;eventId:unknown;expectedSequence:unknown;confirmed:unknown}){
 if(input.confirmed!==true||!validFreelanceId(input.eventId)||!manualKinds.includes(input.kind as ManualKind)||!Number.isSafeInteger(input.expectedSequence)||Number(input.expectedSequence)<0)throw Error('FREELANCE_INVALID');
 const kind=input.kind as ManualKind,id='u-'+input.eventId;
 if(id.length>128)throw Error('FREELANCE_INVALID');
 return adminDb.runTransaction(async tx=>{
  const c=await readAttendanceContext(tx,uid,offerId),t=await readAttendanceTimeline(tx,c);
  if(!t)return fail();
  const existing=t.events.find(e=>e.id===id);
  if(existing){if(existing.kind!==kind||existing.actor!==c.actor)return fail();return;}
  if(t.events.length!==input.expectedSequence||t.events.length>=480||c.offer.status!==(beforeStart.includes(kind)?'contracted':'in_progress'))return fail();
  const write=await append(tx,t,{id,kind,actor:c.actor,at:new Date().toISOString()});write();
 });
}
/** Read/validate first; caller invokes returned write only after all other reads.
 * The operational transition and timeline commit atomically. Unscheduled legacy contracts remain unchanged. */
export async function prepareFreelanceAttendanceLifecycle(tx:Transaction,uid:string,offerId:string,action:'start'|'request_completion'|'confirm_completion',at:string,changed:boolean){
 const c=await readAttendanceContext(tx,uid,offerId),t=await readAttendanceTimeline(tx,c);
 if(!t){if(c.current?.status==='pending'&&action==='start')return fail();return ()=>{};}
 const kind=action==='start'?'start':action==='request_completion'?'checkout':'confirm_checkout';
 const id='l-'+action;
 if(!changed){const existing=t.events.find(e=>e.id===id);if(!existing||existing.kind!==kind||existing.actor!==c.actor||existing.at!==at)return fail();return ()=>{};}
 return append(tx,t,{id,kind,actor:c.actor,at});
}
/** Only lifecycle and MFA-protected administration can create system events. */
export async function prepareFreelanceAttendanceReview(tx:Transaction,participantUid:string,offerId:string,occurrenceId:string,kind:'suspend'|'resume_review',at:string){
 const c=await readAttendanceContext(tx,participantUid,offerId),t=await readAttendanceTimeline(tx,c);
 if(!t)return ()=>{};
 const id='s-'+createHash('sha256').update(JSON.stringify([occurrenceId,kind])).digest('hex');
 return append(tx,t,{id,kind,actor:'system',at});
}
