// Pure policy for the simulated SOS workflow. No network, provider or database writes.
// All identities, verified numbers and time must come from trusted server state.
// Production must enforce these decisions in an atomic persistence transaction.
import {isTagId} from '../../shared/kyrubTagContract.js';

type VerifiedPhone={phone:string;verifiedAt:number;consent:boolean};
type SosProfile={tagId:string;ownerId:string;displayName:string;active:boolean;enabled:boolean;owner:VerifiedPhone;contacts:VerifiedPhone[]};
type Recipient={phone:string;role:'owner'|'contact'};
export type CidSosOccurrence={id:string;tagId:string;ownerId:string;displayName:string;createdAt:number;recipients:Recipient[];status:'open'|'owner-safe';resolvedAt?:number};
export type CidSosMessage={key:string;phone:string;kind:'alert'|'owner-safe';text:string};
const fail=():never=>{throw Error('CID_SOS_UNAVAILABLE');};
const validId=(v:unknown):v is string=>typeof v==='string'&&/^[A-Za-z0-9_-]{22,80}$/.test(v);
const validTime=(v:unknown):v is number=>typeof v==='number'&&Number.isSafeInteger(v)&&v>0;
function safeDisplayName(v:unknown):v is string{
 return typeof v==='string'&&v.trim()===v&&v.length>0&&v.length<=80&&!/[\u0000-\u001f\u007f-\u009f\u202a-\u202e\u2066-\u2069]/.test(v);
}
function timeLabel(now:number):string{
 return new Intl.DateTimeFormat('pt-BR',{dateStyle:'short',timeStyle:'short',timeZone:'America/Sao_Paulo'}).format(now)+' (Brasília)';
}
function verified(v:VerifiedPhone,now:number):boolean{
 return !!v&&v.consent===true&&validTime(v.verifiedAt)&&v.verifiedAt<=now&&typeof v.phone==='string'&&/^\+55[1-9][0-9]9[0-9]{8}$/.test(v.phone);
}
// Conservative pilot proposals, not a production rate-limit configuration.
export const CID_SOS_MIN_INTERVAL_MS=5*60*1000;
export const CID_SOS_DAY_LIMIT=3;
export function planCidSosAlert(profile:SosProfile,request:{id:string;confirmed:boolean},now:number,history:readonly CidSosOccurrence[]):{occurrence:CidSosOccurrence;messages:CidSosMessage[];duplicate:boolean}{
 if(!profile||!isTagId(profile.tagId)||typeof profile.ownerId!=='string'||!profile.ownerId||!safeDisplayName(profile.displayName)||!validTime(now)||!validId(request?.id)||request.confirmed!==true)return fail();
 const prior=history.find(e=>e.id===request.id);
 if(prior){
  if(prior.tagId!==profile.tagId||prior.ownerId!==profile.ownerId)return fail();
  return {occurrence:prior,messages:[],duplicate:true};
 }
 if(profile.active!==true||profile.enabled!==true||!verified(profile.owner,now)||!Array.isArray(profile.contacts)||profile.contacts.length<1||profile.contacts.length>2||profile.contacts.some(c=>!verified(c,now)))return fail();
 const ownHistory=history.filter(e=>e.tagId===profile.tagId);
 if(ownHistory.some(e=>!validTime(e.createdAt)||e.createdAt>now))return fail();
 if(ownHistory.some(e=>now-e.createdAt<CID_SOS_MIN_INTERVAL_MS)||ownHistory.filter(e=>now-e.createdAt<86400000).length>=CID_SOS_DAY_LIMIT)return fail();
 const recipients:Recipient[]=[{phone:profile.owner.phone,role:'owner'}];
 for(const contact of profile.contacts){
  if(recipients.some(r=>r.phone===contact.phone))return fail();
  recipients.push({phone:contact.phone,role:'contact'});
 }
 const occurrence:CidSosOccurrence={id:request.id,tagId:profile.tagId,ownerId:profile.ownerId,displayName:profile.displayName,createdAt:now,recipients,status:'open'};
 return {occurrence,duplicate:false,messages:recipients.map((r,i)=>({key:occurrence.id+':alert:'+i,phone:r.phone,kind:'alert',text:r.role==='owner'?'Kyrub CID: SOS solicitado no seu cartão em '+timeLabel(now)+'. Se estiver bem, atualize a ocorrência.':'Kyrub CID: SOS solicitado no cartão de '+occurrence.displayName+' em '+timeLabel(now)+'. Verifique a situação. O alerta não comprova uma emergência.'}))};
}
// Only a server-verified owner may resolve an occurrence. Do not take identity from public requests.
export function planCidSosOwnerSafe(occurrence:CidSosOccurrence,verifiedOwnerId:string,now:number):{occurrence:CidSosOccurrence;messages:CidSosMessage[]}{
 if(!occurrence||!validId(occurrence.id)||!safeDisplayName(occurrence.displayName)||!verifiedOwnerId||verifiedOwnerId!==occurrence.ownerId||!validTime(now)||now<occurrence.createdAt)return fail();
 if(occurrence.status==='owner-safe')return {occurrence,messages:[]};
 if(occurrence.status!=='open')return fail();
 return {occurrence:{...occurrence,status:'owner-safe',resolvedAt:now},messages:occurrence.recipients.flatMap((r,i)=>r.role==='contact'?[{key:occurrence.id+':owner-safe:'+i,phone:r.phone,kind:'owner-safe' as const,text:'Kyrub CID: '+occurrence.displayName+' informou estar bem ou que o SOS de '+timeLabel(occurrence.createdAt)+' foi indevido. Declaração do titular, não verificação de segurança.'}]:[])};
}
// Deliberately no numbers, owner identifiers, message content or history in the public capability.
export function publicCidSosCapability(profile:SosProfile,now:number):{available:boolean}{
 try{return {available:safeDisplayName(profile.displayName)&&profile.active===true&&profile.enabled===true&&verified(profile.owner,now)&&Array.isArray(profile.contacts)&&profile.contacts.length>=1&&profile.contacts.length<=2&&profile.contacts.every(c=>verified(c,now))&&new Set([profile.owner.phone,...profile.contacts.map(c=>c.phone)]).size===profile.contacts.length+1};}catch{return {available:false};}
}
