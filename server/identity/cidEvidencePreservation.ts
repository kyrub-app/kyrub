// Policy only. No log collection, disclosure, permanent retention, or external reporting.
// A future trusted server adapter must verify roles, case authorization, dates, legal review,
// transactional persistence, and audit events. No client-supplied role is authoritative.
import {randomUUID} from 'node:crypto';
import {authorizeCidChatSession,type CidChat,type ChatSession} from './cidOccurrenceChatAccess.js';
const deny=():never=>{throw Error('CID_EVIDENCE_FORBIDDEN');};
const time=(v:unknown):v is number=>typeof v==='number'&&Number.isSafeInteger(v)&&v>0;
export type PreservationRequest={id:string;occurrenceId:string;requestedAt:number;status:'pending-review';reason:string};
export function requestCidEvidencePreservation(chat:CidChat,session:ChatSession,secret:unknown,reason:unknown,now:number):PreservationRequest{
 const member=authorizeCidChatSession(chat,session,secret,now,'read');
 if(member.role!=='owner'||member.id!==chat.ownerId||!time(now)||typeof reason!=='string'||reason.length>1000)return deny();
 const normalized=reason.trim().normalize('NFC');
 if(!normalized||normalized.length>500||/[\u0000-\u001f\u007f-\u009f\u202a-\u202e\u2066-\u2069]/.test(normalized))return deny();
 return {id:randomUUID(),occurrenceId:chat.id,requestedAt:now,status:'pending-review',reason:normalized};
}
// A preservation request by itself authorizes neither disclosure nor indefinite retention.
export type ReviewedEvidenceCase={id:string;occurrenceId:string;status:'approved'|'revoked';purpose:'preservation'|'authority-disclosure';reviewedAt:number;expiresAt:number;allowedFields:readonly EvidenceField[];authorizedActorId:string};
export type EvidenceField='sourceIp'|'connectionTime'|'sourcePort'|'declaredClient'|'internalSessionReference';
const permitted:readonly EvidenceField[]=['sourceIp','connectionTime','sourcePort','declaredClient','internalSessionReference'];
export type VerifiedEvidenceOperator={id:string;role:'evidence-officer';recentAuthenticationAt:number};
// No raw data read here. Return only a narrow authorization plan for an audited adapter.
export function planRestrictedEvidenceAccess(review:ReviewedEvidenceCase,actor:VerifiedEvidenceOperator,occurrenceId:string,fields:readonly EvidenceField[],now:number){
 if(!review||!actor||actor.role!=='evidence-officer'||!actor.id||review.authorizedActorId!==actor.id||review.occurrenceId!==occurrenceId||review.status!=='approved'||review.purpose!=='authority-disclosure'||!time(now)||!time(review.reviewedAt)||!time(review.expiresAt)||review.reviewedAt>now||review.expiresAt<=now||!time(actor.recentAuthenticationAt)||actor.recentAuthenticationAt>now||now-actor.recentAuthenticationAt>5*60*1000||!Array.isArray(fields)||!fields.length||new Set(fields).size!==fields.length||fields.some(f=>!permitted.includes(f)||!review.allowedFields.includes(f)))return deny();
 return {caseId:review.id,occurrenceId,actorId:actor.id,fields:[...fields],authorizedAt:now,requiresAudit:true as const};
}
