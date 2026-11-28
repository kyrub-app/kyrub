import {FREELANCE_MAX_ESTIMATED_MINUTES} from './freelanceWorkTerms.js';
import type {FreelanceHourlyExtension} from './freelanceHourlyAccounting.js';
type Role='worker'|'requester';
export type FreelanceExtensionProposal={id:string;extraMinutes:number;proposedBy:Role;proposedAt:string;status:'pending'|'accepted'|'declined'|'withdrawn';decidedBy?:Role;decidedAt?:string};
const fail=():never=>{throw Error('FREELANCE_HOURLY_ACCOUNTING_CONFLICT');};
const iso=(v:unknown):v is string=>typeof v==='string'&&Number.isFinite(Date.parse(v))&&new Date(Date.parse(v)).toISOString()===v;
export function readFreelanceExtensionProposal(raw:unknown):FreelanceExtensionProposal{
 if(!raw||typeof raw!=='object'||Array.isArray(raw))return fail();
 const r=raw as FreelanceExtensionProposal;
 if(typeof r.id!=='string'||!/^[A-Za-z0-9_-]{1,128}$/.test(r.id)||!Number.isSafeInteger(r.extraMinutes)||r.extraMinutes<1||r.extraMinutes>FREELANCE_MAX_ESTIMATED_MINUTES||!['worker','requester'].includes(r.proposedBy)||!iso(r.proposedAt)||!['pending','accepted','declined','withdrawn'].includes(r.status))return fail();
 if(r.status==='pending'){if(Object.keys(r).length!==5||r.decidedAt!==undefined||r.decidedBy!==undefined)return fail();}
 else if(Object.keys(r).length!==7||!iso(r.decidedAt)||Date.parse(r.decidedAt)<Date.parse(r.proposedAt)||!['worker','requester'].includes(r.decidedBy??'')||(r.status==='withdrawn'?r.decidedBy!==r.proposedBy:r.decidedBy===r.proposedBy))return fail();
 return {id:r.id,extraMinutes:r.extraMinutes,proposedBy:r.proposedBy,proposedAt:r.proposedAt,status:r.status,...(r.status==='pending'?{}:{decidedBy:r.decidedBy!,decidedAt:r.decidedAt!})};
}
export function projectAcceptedFreelanceExtensions(records:readonly FreelanceExtensionProposal[]):FreelanceHourlyExtension[]{
 return records.filter(r=>r.status==='accepted').map(r=>({id:r.id,extraMinutes:r.extraMinutes,proposedBy:r.proposedBy,proposedAt:r.proposedAt,acceptedBy:r.decidedBy!,acceptedAt:r.decidedAt!}));
}
export function decideFreelanceExtension(raw:unknown,actor:Role,status:'accepted'|'declined'|'withdrawn',now:string){
 const r=readFreelanceExtensionProposal(raw);
 if(status==='withdrawn'?actor!==r.proposedBy:actor===r.proposedBy)throw Error('FREELANCE_FORBIDDEN');
 if(r.status===status&&r.decidedBy===actor)return r;
 if(r.status!=='pending')return fail();
 return readFreelanceExtensionProposal({...r,status,decidedBy:actor,decidedAt:now});
}
