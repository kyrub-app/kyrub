// Server-only policy. No endpoint, delivery provider, database write, or production session.
// Callers must supply trusted server state and atomically consume invitations / revoke sessions.
import {createHash,randomBytes,timingSafeEqual} from 'node:crypto';
import {CID_SOS_CHAT_GREETING,CID_SOS_NOTICE} from '../../shared/cidSosRequest.js';
import {isTagId} from '../../shared/kyrubTagContract.js';
import type {CidSosOccurrence} from './cidSosAlertPolicy.js';
type Role='owner'|'emitter'|'contact';
type Member={id:string;role:Role};
export type CidChat={id:string;tagId:string;ownerId:string;createdAt:number;members:Member[];closedAt?:number};
export type ChatInvite={id:string;chatId:string;memberId:string;digest:string;createdAt:number;expiresAt:number;usedAt?:number;revokedAt?:number};
export type ChatSession={id:string;chatId:string;memberId:string;digest:string;createdAt:number;expiresAt:number;revokedAt?:number};
export type ChatMessage={id:string;chatId:string;authorId:string;body:string;createdAt:number;kind:'message'|'system'};
const deny=():never=>{throw Error('CID_CHAT_FORBIDDEN');};
const validId=(v:unknown):v is string=>typeof v==='string'&&/^[A-Za-z0-9_-]{1,128}$/.test(v);
const validTime=(v:unknown):v is number=>typeof v==='number'&&Number.isSafeInteger(v)&&v>0;
const token=()=>randomBytes(32).toString('base64url');
const digest=(value:string)=>createHash('sha256').update(value,'utf8').digest('hex');
const tokenMatches=(value:unknown,hash:unknown)=>typeof value==='string'&&/^[A-Za-z0-9_-]{43}$/.test(value)&&typeof hash==='string'&&/^[a-f0-9]{64}$/.test(hash)&&timingSafeEqual(Buffer.from(digest(value),'hex'),Buffer.from(hash,'hex'));
// Pilot proposals, not retention policy. Short-lived invitation; session lifetime independent.
export const CID_CHAT_INVITE_TTL_MS=30*60*1000;
export const CID_CHAT_SESSION_TTL_MS=12*60*60*1000;
function member(chat:CidChat,id:string):Member{
 const found=chat.members.find(p=>p.id===id);
 if(!found)return deny();return found;
}
export function createCidOccurrenceChat(occurrence:CidSosOccurrence,verifiedEmitterId:string,now:number):{chat:CidChat;greeting:ChatMessage}{
 if(!occurrence||!validId(occurrence.id)||!isTagId(occurrence.tagId)||!validId(occurrence.ownerId)||!validId(verifiedEmitterId)||verifiedEmitterId===occurrence.ownerId||verifiedEmitterId==='system'||occurrence.ownerId==='system'||!validTime(now)||now<occurrence.createdAt||occurrence.status!=='open')return deny();
 const contacts=[...new Set(occurrence.recipients.filter(r=>r.role==='contact').map(r=>r.participantId))];
 if(contacts.length<1||contacts.length>3||contacts.some(id=>!validId(id)||id==='system'||id===verifiedEmitterId||id===occurrence.ownerId))return deny();
 const chat:CidChat={id:occurrence.id,tagId:occurrence.tagId,ownerId:occurrence.ownerId,createdAt:now,members:[{id:occurrence.ownerId,role:'owner'},{id:verifiedEmitterId,role:'emitter'},...contacts.map(id=>({id,role:'contact' as const}))]};
 return {chat,greeting:{id:chat.id+'-greeting',chatId:chat.id,authorId:'system',body:CID_SOS_CHAT_GREETING,createdAt:now,kind:'system'}};
}
// Invites only for notification recipients; issuer must be an authorized delivery service.
// Link carries secret only in URL fragment; POST exchange removes it from browser address.
// This module does not generate links or deliver messages.
export function issueCidChatInvite(chat:CidChat,recipientId:string,now:number){
 const p=member(chat,recipientId);
 if(p.role!=='contact'||chat.closedAt!==undefined||!validTime(now)||now<chat.createdAt)return deny();
 const secret=token();
 return {secret,record:{id:token(),chatId:chat.id,memberId:p.id,digest:digest(secret),createdAt:now,expiresAt:now+CID_CHAT_INVITE_TTL_MS} satisfies ChatInvite};
}
function newSession(chat:CidChat,p:Member,now:number){
 if(!validTime(now)||now<chat.createdAt)return deny();
 const secret=token();
 return {secret,record:{id:token(),chatId:chat.id,memberId:p.id,digest:digest(secret),createdAt:now,expiresAt:now+CID_CHAT_SESSION_TTL_MS} satisfies ChatSession};
}
// Must compare and consume in one transaction. Recipient confirmation is an independent
// trusted proof of control of the invited channel; bearer link alone is insufficient.
export function redeemCidChatInvite(chat:CidChat,invite:ChatInvite,secret:unknown,verifiedRecipientId:string,now:number){
 if(chat.closedAt!==undefined||invite.chatId!==chat.id||invite.memberId!==verifiedRecipientId||invite.usedAt!==undefined||invite.revokedAt!==undefined||!validTime(now)||now<invite.createdAt||now>=invite.expiresAt||!tokenMatches(secret,invite.digest))return deny();
 const p=member(chat,verifiedRecipientId);if(p.role!=='contact')return deny();
 return {invite:{...invite,usedAt:now},session:newSession(chat,p,now)};
}
// Owner passkey and emitter session must be independently verified by the adapter.
export function openCidChatSession(chat:CidChat,verifiedMemberId:string,proof:'owner-passkey'|'emitter-session',now:number){
 const p=member(chat,verifiedMemberId);
 if((p.role==='owner'&&proof!=='owner-passkey')||(p.role==='emitter'&&proof!=='emitter-session')||p.role==='contact')return deny();
 return newSession(chat,p,now);
}
export function authorizeCidChatSession(chat:CidChat,session:ChatSession,secret:unknown,now:number,action:'read'|'write'|'close'){
 if(session.chatId!==chat.id||session.revokedAt!==undefined||!validTime(now)||now<session.createdAt||now>=session.expiresAt||!tokenMatches(secret,session.digest))return deny();
 const p=member(chat,session.memberId);
 if(action!=='read'&&chat.closedAt!==undefined)return deny();
 if(action==='close'&&p.role!=='owner')return deny();
 return p;
}
// Scope and identity come from validated server session, never a client-supplied author.
export function prepareCidChatMessage(chat:CidChat,session:ChatSession,secret:unknown,input:unknown,now:number):ChatMessage{
 const p=authorizeCidChatSession(chat,session,secret,now,'write');
 if(!input||typeof input!=='object'||Array.isArray(input))return deny();
 const value=input as Record<string,unknown>;
 if(Object.keys(value).some(k=>k!=='id'&&k!=='body')||!validId(value.id)||typeof value.body!=='string'||value.body.length>4000)return deny();
 const body=value.body.normalize('NFC').trim();
 if(value.id===chat.id+'-greeting'||value.id===chat.id+'-resolution'||!body||body.length>2000||/[\u0000-\u0008\u000b-\u001f\u007f-\u009f\u202a-\u202e\u2066-\u2069]/.test(body))return deny();
 return {id:value.id,chatId:chat.id,authorId:p.id,body,createdAt:now,kind:'message'};
}
export function closeCidChat(chat:CidChat,session:ChatSession,secret:unknown,now:number):CidChat{
 authorizeCidChatSession(chat,session,secret,now,'close');return {...chat,closedAt:now};
}
// No recipient addresses, technical access data, session ids or hashes in the chat projection.
export function projectCidChat(chat:CidChat,session:ChatSession,secret:unknown,now:number){
 const p=authorizeCidChatSession(chat,session,secret,now,'read');
 return {id:chat.id,tagId:chat.tagId,role:p.role,closed:chat.closedAt!==undefined,participantCount:chat.members.length,notice:CID_SOS_NOTICE};
}
