import {randomUUID} from 'node:crypto';
import {normalizePrivacyRequest,type PrivacyRequestDraft} from '../../shared/privacyRights.js';
// Internal domain policy. A future transport must establish requester identity,
// durable receipt and idempotency, then restrict all reads to the verified subject.
// A verified delivery channel is NOT proof of identity for exporting/deleting data.
export type VerifiedPrivacyChannel={reference:string;verifiedAt:number};
export type PrivacyRequestRecord={protocol:string;draft:PrivacyRequestDraft;channelReference:string;receivedAt:number;status:'received';identityStatus:'pending-verification';actionStatus:'not-executed';simulation:true};
const deny=():never=>{throw Error('PRIVACY_REQUEST_FORBIDDEN');};
export function preparePrivacyRequest(input:unknown,channel:VerifiedPrivacyChannel,now:number):PrivacyRequestRecord{
 const draft=normalizePrivacyRequest(input);
 if(!Number.isSafeInteger(now)||now<=0||!channel||typeof channel.reference!=='string'||!/^[A-Za-z0-9_-]{22,128}$/.test(channel.reference)||!Number.isSafeInteger(channel.verifiedAt)||channel.verifiedAt<=0||channel.verifiedAt>now||now-channel.verifiedAt>15*60000)return deny();
 // Do not accept user IDs, email addresses, documents, narrative, or consent flags
 // outside the explicit request contract. The channel reference is server-derived.
 return {protocol:randomUUID(),draft,channelReference:channel.reference,receivedAt:now,status:'received',identityStatus:'pending-verification',actionStatus:'not-executed',simulation:true};
}
export function projectPrivacyReceipt(record:PrivacyRequestRecord){
 if(!record||record.simulation!==true||record.status!=='received'||record.actionStatus!=='not-executed'||record.identityStatus!=='pending-verification'||!(/^[a-f0-9-]{36}$/).test(record.protocol))return deny();
 return {protocol:record.protocol,status:'received' as const,simulated:true as const};
}
