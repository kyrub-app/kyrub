import type {FreelanceAttendanceSchedule} from './freelanceAttendance.js';
export type FreelanceScheduleProposal={id:string;schedule:FreelanceAttendanceSchedule;proposedBy:'worker'|'requester';proposedAt:string;status:'pending'|'accepted'|'declined'|'withdrawn';decidedAt?:string;decidedBy?:'worker'|'requester'};
const fail=():never=>{throw Error('FREELANCE_ATTENDANCE_CONFLICT');};
const iso=(v:unknown):v is string=>typeof v==='string'&&Number.isFinite(Date.parse(v))&&new Date(Date.parse(v)).toISOString()===v;
const id=(v:unknown):v is string=>typeof v==='string'&&/^[A-Za-z0-9_-]{1,128}$/.test(v);
export function readFreelanceScheduleProposal(raw:unknown):FreelanceScheduleProposal{
 if(!raw||typeof raw!=='object'||Array.isArray(raw))return fail();
 const r=raw as FreelanceScheduleProposal,s=r.schedule;
 if(!id(r.id)||!s||typeof s!=='object'||Array.isArray(s)||Object.keys(s).length!==3||!['on_site','remote'].includes(s.location)||!iso(s.scheduledStartAt)||!Number.isSafeInteger(s.agreedMinutes)||s.agreedMinutes<1||s.agreedMinutes>10080||
 !['worker','requester'].includes(r.proposedBy)||!iso(r.proposedAt)||Date.parse(s.scheduledStartAt)<=Date.parse(r.proposedAt)||!['pending','accepted','declined','withdrawn'].includes(r.status))return fail();
 if(r.status==='pending'){if(Object.keys(r).length!==5||r.decidedAt!==undefined||r.decidedBy!==undefined)return fail();}
 else if(Object.keys(r).length!==7||!iso(r.decidedAt)||Date.parse(r.decidedAt)<Date.parse(r.proposedAt)||!['worker','requester'].includes(r.decidedBy??'')||
 (r.status==='withdrawn'?r.decidedBy!==r.proposedBy:r.decidedBy===r.proposedBy)||
 (r.status==='accepted'&&Date.parse(r.decidedAt)>=Date.parse(s.scheduledStartAt)))return fail();
 return {id:r.id,schedule:{location:s.location,scheduledStartAt:s.scheduledStartAt,agreedMinutes:s.agreedMinutes},proposedBy:r.proposedBy,proposedAt:r.proposedAt,status:r.status,...(r.status==='pending'?{}:{decidedAt:r.decidedAt!,decidedBy:r.decidedBy!})};
}
export function createFreelanceScheduleProposal(input:{id:unknown;scheduledStartAt:unknown;location:FreelanceAttendanceSchedule['location'];agreedMinutes:number;actor:'worker'|'requester';now:string}){
 return readFreelanceScheduleProposal({id:input.id,schedule:{location:input.location,scheduledStartAt:input.scheduledStartAt,agreedMinutes:input.agreedMinutes},proposedBy:input.actor,proposedAt:input.now,status:'pending'});
}
export function decideFreelanceScheduleProposal(raw:unknown,actor:'worker'|'requester',decision:'accepted'|'declined'|'withdrawn',now:string){
 const r=readFreelanceScheduleProposal(raw);
 if(!['accepted','declined','withdrawn'].includes(decision))return fail();
 if(decision==='withdrawn'?actor!==r.proposedBy:actor===r.proposedBy)throw Error('FREELANCE_FORBIDDEN');
 if(r.status===decision&&r.decidedBy===actor)return r;
 if(r.status!=='pending')return fail();
 return readFreelanceScheduleProposal({...r,status:decision,decidedBy:actor,decidedAt:now});
}
