import {projectFreelanceAttendance,type FreelanceAttendanceSchedule,type FreelanceAttendanceEvent} from './freelanceAttendance.js';
import {readFreelanceWorkTerms,FREELANCE_MAX_ESTIMATED_MINUTES} from './freelanceWorkTerms.js';

/** Domain calculation only. Future server adapter must source these records
 * from bilateral, immutable authorization transactions, not request payloads. */
export type FreelanceHourlyExtension={id:string;extraMinutes:number;proposedBy:'worker'|'requester';proposedAt:string;acceptedBy:'worker'|'requester';acceptedAt:string};
const fail=():never=>{throw Error('FREELANCE_HOURLY_ACCOUNTING_CONFLICT');};
const iso=(v:unknown):v is string=>typeof v==='string'&&Number.isFinite(Date.parse(v))&&new Date(Date.parse(v)).toISOString()===v;
const MAX_MINOR=999999999;
function price(rate:number,ms:number){
 const minor=(BigInt(rate)*BigInt(ms)+1800000n)/3600000n;
 if(minor>BigInt(MAX_MINOR))return fail();
 return Number(minor);
}
/** No automatic settlement, no implicit waiver of excess and no inference
 * of zero due when the service has not been bilaterally confirmed. */
export function calculateFreelanceHourlyAccounting(input:{
 workTerms:unknown;estimatedMinor:number;schedule:FreelanceAttendanceSchedule;
 events:readonly FreelanceAttendanceEvent[];extensions:readonly FreelanceHourlyExtension[];
}){
 const terms=readFreelanceWorkTerms(input.workTerms,input.estimatedMinor);
 if(!terms||terms.mode!=='hourly'||terms.location!==input.schedule.location||terms.estimatedMinutes!==input.schedule.agreedMinutes||
 !Array.isArray(input.extensions)||input.extensions.length>64)return fail();
 const projection=projectFreelanceAttendance(input.schedule,input.events);
 let authorizedMinutes=terms.estimatedMinutes,lastAccepted=-Infinity;
 const ids=new Set<string>();
 for(const e of input.extensions){
  if(!e||typeof e!=='object'||Object.keys(e).length!==6||typeof e.id!=='string'||!/^[A-Za-z0-9_-]{1,128}$/.test(e.id)||ids.has(e.id)||
  !Number.isSafeInteger(e.extraMinutes)||e.extraMinutes<1||e.extraMinutes>FREELANCE_MAX_ESTIMATED_MINUTES-authorizedMinutes||
  !['worker','requester'].includes(e.proposedBy)||!['worker','requester'].includes(e.acceptedBy)||e.proposedBy===e.acceptedBy||
  !iso(e.proposedAt)||!iso(e.acceptedAt))return fail();
  const proposed=Date.parse(e.proposedAt),accepted=Date.parse(e.acceptedAt);
  if(proposed<lastAccepted||accepted<proposed)return fail();
  // Strictly earlier timeline entries establish the state at each authorization.
  // Same-timestamp boundary events are rejected conservatively until a unified sequence exists.
  if(input.events.some(event=>event.at===e.proposedAt||event.at===e.acceptedAt))return fail();
  for(const at of [e.proposedAt,e.acceptedAt]){
   const prefix=input.events.filter(event=>Date.parse(event.at)<Date.parse(at));
   const before=projectFreelanceAttendance(input.schedule,prefix,at);
   if(!['working','waiting','paused'].includes(before.status)||before.elapsedCompensableMs>=authorizedMinutes*60000)return fail();
  }
  ids.add(e.id);authorizedMinutes+=e.extraMinutes;lastAccepted=accepted;
 }
 const authorizedMs=authorizedMinutes*60000;
 const authorizedCapMinor=price(terms.hourlyRateMinor,authorizedMs);
 const recordedMs=projection.compensableMs;
 const excessMs=Math.max(0,recordedMs-authorizedMs);
 const status=projection.status==='suspended'?'requires_suspension_review':!projection.readyForReview?'awaiting_confirmation':excessMs>0?'requires_excess_review':'calculated';
 const withinCapReferenceMinor=price(terms.hourlyRateMinor,Math.min(recordedMs,authorizedMs));
 return {currency:'BRL' as const,estimatedMinor:input.estimatedMinor,hourlyRateMinor:terms.hourlyRateMinor,
 authorizedMinutes,authorizedCapMinor,workMs:projection.workMs,waitMs:projection.waitMs,breakMs:projection.breakMs,
 compensableMs:recordedMs,excessMs,withinCapReferenceMinor,
 calculatedServiceMinor:status==='calculated'?withinCapReferenceMinor:null,status,
 bankVerified:false as const,settlement:'not_verified' as const};
}
