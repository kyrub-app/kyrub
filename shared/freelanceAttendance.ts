/** Operational candidate only. Server timestamps and authenticated roles must
 * be supplied by a future transactional adapter. No GPS proof, payroll or debt. */
export type FreelanceAttendanceSchedule={location:'on_site'|'remote';scheduledStartAt:string;agreedMinutes:number};
export type FreelanceAttendanceKind='check_in'|'confirm_presence'|'authorize_early_start'|'acknowledge_waiting'|'start'|'request_break'|'approve_break'|'resume'|'checkout'|'confirm_checkout'|'suspend'|'resume_review';
export type FreelanceAttendanceEvent={id:string;kind:FreelanceAttendanceKind;actor:'worker'|'requester'|'system';at:string};
const fail=():never=>{throw Error('FREELANCE_ATTENDANCE_CONFLICT');};
const time=(v:unknown):number=>{
 if(typeof v!=='string')return fail();
 const t=Date.parse(v);
 if(!Number.isFinite(t)||new Date(t).toISOString()!==v)return fail();
 return t;
};
const actors:Record<FreelanceAttendanceKind,FreelanceAttendanceEvent['actor']>={check_in:'worker',confirm_presence:'requester',authorize_early_start:'requester',acknowledge_waiting:'requester',start:'worker',request_break:'worker',approve_break:'requester',resume:'worker',checkout:'worker',confirm_checkout:'requester',suspend:'system',resume_review:'system'};
export function projectFreelanceAttendance(schedule:FreelanceAttendanceSchedule,events:readonly FreelanceAttendanceEvent[]){
 const scheduled=time(schedule.scheduledStartAt);
 if(!['on_site','remote'].includes(schedule.location)||!Number.isSafeInteger(schedule.agreedMinutes)||schedule.agreedMinutes<1||schedule.agreedMinutes>10080||!Array.isArray(events)||events.length>512)return fail();
 let arrived:number|null=null,presence=false,early=false,started=false,waiting:number|null=null,work:number|null=null,breakAsked=false,pause:number|null=null,checkout:number|null=null,confirmed=false,suspended=false,reviewHold=false,waitFloor=-Infinity;
 let workMs=0,waitMs=0,breakMs=0,last=-Infinity;
 const ids=new Set<string>();
 for(const e of events){
  if(!e||!Object.prototype.hasOwnProperty.call(actors,e.kind)||e.actor!==actors[e.kind]||typeof e.id!=='string'||!/^[A-Za-z0-9_-]{1,128}$/.test(e.id)||ids.has(e.id))return fail();
  const at=time(e.at);if(at<last||confirmed||(suspended&&e.kind!=='resume_review')||(!suspended&&e.kind==='resume_review'))return fail();last=at;ids.add(e.id);
  switch(e.kind){
   case 'check_in':if(schedule.location!=='on_site'||arrived!==null||work!==null||checkout!==null)return fail();arrived=at;break;
   case 'confirm_presence':if(arrived===null||presence||checkout!==null)return fail();presence=true;break;
   case 'authorize_early_start':if(early||at>=scheduled||started||checkout!==null)return fail();early=true;break;
   case 'acknowledge_waiting':if(schedule.location!=='on_site'||!presence||arrived===null||waiting!==null||started||checkout!==null||at<scheduled)return fail();waiting=Math.max(scheduled,arrived,waitFloor);break;
   case 'start':
    if(started||pause!==null||checkout!==null||(schedule.location==='on_site'&&!presence)||(at<scheduled&&!early))return fail();
    if(waiting!==null){waitMs+=at-waiting;waiting=null;}
    started=true;work=at;break;
   case 'request_break':if(work===null||pause!==null||breakAsked||checkout!==null)return fail();breakAsked=true;break;
   case 'approve_break':if(work===null||!breakAsked||pause!==null||checkout!==null)return fail();workMs+=at-work;pause=at;work=null;breakAsked=false;break;
   case 'resume':if((pause===null&&!reviewHold)||checkout!==null)return fail();if(pause!==null)breakMs+=at-pause;pause=null;reviewHold=false;work=at;break;
   case 'checkout':
    if(checkout!==null||(work===null&&pause===null&&waiting===null&&!reviewHold))return fail();
    if(work!==null)workMs+=at-work;
    if(pause!==null)breakMs+=at-pause;
    if(waiting!==null)waitMs+=at-waiting;
    work=null;pause=null;waiting=null;breakAsked=false;reviewHold=false;checkout=at;break;
   case 'confirm_checkout':if(checkout===null)return fail();confirmed=true;break;
   case 'suspend':
    if(work!==null)workMs+=at-work;
    if(pause!==null)breakMs+=at-pause;
    if(waiting!==null)waitMs+=at-waiting;
    work=null;pause=null;waiting=null;breakAsked=false;suspended=true;reviewHold=false;break;
   case 'resume_review':suspended=false;waitFloor=at;reviewHold=started&&checkout===null;break;
  }
 }
 const compensableMs=workMs+waitMs;
 if(![workMs,waitMs,breakMs,compensableMs].every(v=>Number.isSafeInteger(v)&&v>=0))return fail();
 return {status:suspended?'suspended':confirmed?'confirmed':checkout!==null?'awaiting_confirmation':reviewHold?'awaiting_resume':pause!==null?'paused':work!==null?'working':waiting!==null?'waiting':presence?'present':arrived!==null?'checked_in':'scheduled',
 workMs,waitMs,breakMs,compensableMs,exceedsAgreedTime:compensableMs>schedule.agreedMinutes*60000,readyForReview:confirmed,earlyAuthorized:early,breakRequested:breakAsked,financialSettlement:'not_verified' as const};
}
