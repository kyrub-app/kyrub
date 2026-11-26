// Pure policy; no real sends, provider, geolocation or database writes.
// Profiles, authenticated identity, delivery evidence and time must originate in trusted server state.
import {isTagId} from '../../shared/kyrubTagContract.js';
import {normalizeCidSosRequest,CID_SOS_MAX_CONTACTS,type CidSosRequest} from '../../shared/cidSosRequest.js';
type Channel='email'|'whatsapp'|'sms';
type VerifiedChannel={channel:Channel;address:string;verifiedAt:number;consent:boolean};
type Participant={id:string;channels:VerifiedChannel[]};
type SosProfile={tagId:string;ownerId:string;displayName:string;active:boolean;enabled:boolean;owner:Participant;contacts:Participant[]};
type Recipient={participantId:string;role:'owner'|'contact';channel:Channel;address:string};
export type CidSosOccurrence={id:string;tagId:string;ownerId:string;displayName:string;createdAt:number;reason:string;sms:boolean;location?:CidSosRequest['location'];recipients:Recipient[];status:'open'|'owner-safe';resolvedAt?:number};
export type CidSosMessage={key:string;recipient:Recipient;kind:'alert'|'owner-safe';text:string};
const fail=():never=>{throw Error('CID_SOS_UNAVAILABLE');};
const validId=(v:unknown):v is string=>typeof v==='string'&&/^[A-Za-z0-9_-]{22,80}$/.test(v);
const validTime=(v:unknown):v is number=>typeof v==='number'&&Number.isSafeInteger(v)&&v>0;
function safeDisplayName(v:unknown):v is string{
 return typeof v==='string'&&v.trim()===v&&v.length>0&&v.length<=80&&!/[\u0000-\u001f\u007f-\u009f\u202a-\u202e\u2066-\u2069]/.test(v);
}
function timeLabel(now:number):string{
 return new Intl.DateTimeFormat('pt-BR',{dateStyle:'short',timeStyle:'short',timeZone:'America/Sao_Paulo'}).format(now)+' (Brasília)';
}
function verified(v:VerifiedChannel,now:number):boolean{
 if(!v||v.consent!==true||!validTime(v.verifiedAt)||v.verifiedAt>now||typeof v.address!=='string')return false;
 if(v.channel==='email')return v.address.length<=254&&/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v.address)&&v.address===v.address.toLowerCase();
 return (v.channel==='sms'||v.channel==='whatsapp')&&/^\+55[1-9][0-9]9[0-9]{8}$/.test(v.address);
}
function planRecipients(profile:SosProfile,now:number,sms:boolean):Recipient[]{
 if(!profile||!isTagId(profile.tagId)||typeof profile.ownerId!=='string'||!profile.ownerId||!safeDisplayName(profile.displayName)||!validTime(now)||profile.active!==true||profile.enabled!==true||profile.owner?.id!==profile.ownerId||!Array.isArray(profile.contacts)||profile.contacts.length<1||profile.contacts.length>CID_SOS_MAX_CONTACTS)return fail();
 const participants=[profile.owner,...profile.contacts],seenIds=new Set<string>(),seenAddresses=new Map<string,string>(),recipients:Recipient[]=[];
 for(const [index,p] of participants.entries()){
  if(!p||typeof p.id!=='string'||!p.id||seenIds.has(p.id)||!Array.isArray(p.channels)||p.channels.length<1||p.channels.length>3)return fail();
  seenIds.add(p.id);
  const seenChannels=new Set<Channel>();
  for(const c of p.channels){
   if(!verified(c,now)||seenChannels.has(c.channel))return fail();
   seenChannels.add(c.channel);
   const addressKey=(c.channel==='email'?'email:':'phone:')+c.address;
   const previous=seenAddresses.get(addressKey);
   if(previous&&previous!==p.id)return fail();
   seenAddresses.set(addressKey,p.id);
   if(c.channel!=='sms'||sms)recipients.push({participantId:p.id,role:index===0?'owner':'contact',channel:c.channel,address:c.address});
  }
  // No SMS-only default: owner and each configured contact must have a verified default channel.
  if(!seenChannels.has('email')&&!seenChannels.has('whatsapp'))return fail();
 }
 return recipients;
}
// Pilot proposals only; atomic rate limits and budget gate are required before public use.
export const CID_SOS_MIN_INTERVAL_MS=5*60*1000;
export const CID_SOS_DAY_LIMIT=3;
export function planCidSosAlert(profile:SosProfile,input:unknown,now:number,history:readonly CidSosOccurrence[]):{occurrence:CidSosOccurrence;messages:CidSosMessage[];duplicate:boolean}{
 const request=normalizeCidSosRequest(input);
 const recipients=planRecipients(profile,now,request.sms);
 const prior=history.find(e=>e.id===request.id);
 if(prior){
  if(prior.tagId!==profile.tagId||prior.ownerId!==profile.ownerId)return fail();
  return {occurrence:prior,messages:[],duplicate:true};
 }
 const ownHistory=history.filter(e=>e.tagId===profile.tagId);
 if(ownHistory.some(e=>!validTime(e.createdAt)||e.createdAt>now))return fail();
 if(ownHistory.some(e=>now-e.createdAt<CID_SOS_MIN_INTERVAL_MS)||ownHistory.filter(e=>now-e.createdAt<86400000).length>=CID_SOS_DAY_LIMIT)return fail();
 const occurrence:CidSosOccurrence={id:request.id,tagId:profile.tagId,ownerId:profile.ownerId,displayName:profile.displayName,createdAt:now,reason:request.reason,sms:request.sms,...(request.location?{location:request.location}:{}),recipients,status:'open'};
 // Free text and precise location remain in the protected occurrence, never external message bodies.
 return {occurrence,duplicate:false,messages:recipients.map((r,i)=>({key:occurrence.id+':alert:'+i,recipient:r,kind:'alert',text:r.role==='owner'?'Kyrub CID: alerta solicitado no seu cartão em '+timeLabel(now)+'. Confira a ocorrência.':'Kyrub CID: alerta solicitado no cartão de '+occurrence.displayName+' em '+timeLabel(now)+'. Confira a ocorrência. O alerta não comprova uma emergência.'}))};
}
// Update only contacts whose initial alerts were actually delivered, using server-side delivery evidence
// AND channels still consented/verified at the time of the update. No provider is integrated here.
export function planCidSosOwnerSafe(occurrence:CidSosOccurrence,verifiedOwnerId:string,now:number,deliveredKeys:readonly string[],currentProfile:SosProfile):{occurrence:CidSosOccurrence;messages:CidSosMessage[]}{
 if(!occurrence||!validId(occurrence.id)||!safeDisplayName(occurrence.displayName)||!verifiedOwnerId||verifiedOwnerId!==occurrence.ownerId||currentProfile?.ownerId!==verifiedOwnerId||currentProfile.tagId!==occurrence.tagId||!validTime(now)||now<occurrence.createdAt)return fail();
 if(occurrence.status==='owner-safe')return {occurrence,messages:[]};
 if(occurrence.status!=='open')return fail();
 const contacts=Array.isArray(currentProfile.contacts)?currentProfile.contacts:[];
 return {occurrence:{...occurrence,status:'owner-safe',resolvedAt:now},messages:occurrence.recipients.flatMap((r,i)=>r.role==='contact'&&deliveredKeys.includes(occurrence.id+':alert:'+i)&&contacts.some(p=>p.id===r.participantId&&p.channels.some(c=>c.channel===r.channel&&c.address===r.address&&verified(c,now)))?[{key:occurrence.id+':owner-safe:'+i,recipient:r,kind:'owner-safe' as const,text:'Kyrub CID: '+occurrence.displayName+' informou estar bem ou que o alerta de '+timeLabel(occurrence.createdAt)+' foi indevido. Declaração do titular, não verificação de segurança.'}]:[])};
}
export function publicCidSosCapability(profile:SosProfile,now:number):{available:boolean;smsAvailable:boolean}{
 try{planRecipients(profile,now,false);return {available:true,smsAvailable:planRecipients(profile,now,true).some(r=>r.channel==='sms')};}catch{return {available:false,smsAvailable:false};}
}
