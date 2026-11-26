// Server-only foundation, not PDF rendering, a persistence layer or a legal evidence service.
// The adapter must load a complete authorized snapshot atomically and audit each export.
import {createHash,randomUUID} from 'node:crypto';
import {authorizeCidChatSession,type CidChat,type ChatSession,type ChatMessage} from './cidOccurrenceChatAccess.js';
import type {CidSosOccurrence} from './cidSosAlertPolicy.js';
const deny=():never=>{throw Error('CID_REPORT_FORBIDDEN');};
const time=(v:unknown):v is number=>typeof v==='number'&&Number.isSafeInteger(v)&&v>0;
export const CID_REPORT_NOTICE='Registro das informações disponíveis no momento da emissão. Não comprova identidade civil, localização física da Tag nem a veracidade das declarações.';
function snapshot(chat:CidChat,session:ChatSession,secret:unknown,occurrence:CidSosOccurrence,history:readonly ChatMessage[],now:number){
 const member=authorizeCidChatSession(chat,session,secret,now,'read');
 if(member.role!=='owner'||chat.ownerId!==member.id||occurrence.id!==chat.id||occurrence.tagId!==chat.tagId||occurrence.ownerId!==chat.ownerId||!time(occurrence.createdAt)||occurrence.createdAt>now||!time(chat.createdAt)||chat.createdAt<occurrence.createdAt||chat.createdAt>now||!Array.isArray(history)||typeof occurrence.reason!=='string')return deny();
 const labels=new Map<string,string>();let contact=0;
 for(const p of chat.members){
  if(labels.has(p.id)||p.id==='system')return deny();
  labels.set(p.id,p.role==='owner'?'Titular':p.role==='emitter'?'Emissor do alerta':'Contato de emergência '+(++contact));
 }
 const seen=new Set<string>();
 const messages=history.map(m=>{
  if(m.chatId!==chat.id||!time(m.createdAt)||m.createdAt<chat.createdAt||m.createdAt>now||typeof m.id!=='string'||!m.id||seen.has(m.id)||typeof m.body!=='string'||m.body.length>2000||(m.kind!=='message'&&m.kind!=='system'))return deny();
  if(chat.closedAt!==undefined&&m.createdAt>chat.closedAt)return deny();
  seen.add(m.id);
  const label=m.kind==='system'?(m.authorId==='system'?'Sistema':null):labels.get(m.authorId);
  if(!label)return deny();
  return {id:m.id,author:label,body:m.body,createdAt:m.createdAt,kind:m.kind};
 }).sort((a,b)=>a.createdAt-b.createdAt||(a.id<b.id?-1:a.id>b.id?1:0));
 const location=occurrence.location;
 if(location&&(location.consent!==true||!Number.isFinite(location.latitude)||Math.abs(location.latitude)>90||!Number.isFinite(location.longitude)||Math.abs(location.longitude)>180||!Number.isFinite(location.accuracy)||location.accuracy<0||location.accuracy>10000000))return deny();
 return {schema:'cid-occurrence-report-v1' as const,occurrenceId:occurrence.id,tagId:occurrence.tagId,reason:occurrence.reason,openedAt:occurrence.createdAt,closedAt:chat.closedAt??null,participantCount:chat.members.length,location:location?{latitude:location.latitude,longitude:location.longitude,accuracy:location.accuracy,source:'voluntary-participant' as const,registeredAt:occurrence.createdAt}:null,messages,notice:CID_REPORT_NOTICE};
}
export function prepareCidOccurrenceReport(chat:CidChat,session:ChatSession,secret:unknown,occurrence:CidSosOccurrence,history:readonly ChatMessage[],now:number){
 const content={...snapshot(chat,session,secret,occurrence,history,now),reportId:randomUUID(),issuedAt:now};
 // Hash checks the serialized snapshot, not the truth of its contents or a digital signature.
 // Store the hash in a trusted private issuance register before offering verification.
 const checksum=createHash('sha256').update(JSON.stringify(content),'utf8').digest('hex');
 return {content,checksum,algorithm:'SHA-256' as const};
}
// Plain text for a future authorized download endpoint; never interpolate HTML.
export function formatCidConversationText(report:ReturnType<typeof prepareCidOccurrenceReport>){
 const r=report.content;
 const iso=(n:number)=>new Date(n).toISOString();
 return ['KYRUB — Relatório de ocorrência','Identificador: '+r.reportId,'Ocorrência: '+r.occurrenceId,'Tag: '+r.tagId,'Emissão (UTC): '+iso(r.issuedAt),'Motivo: '+r.reason,r.notice,'',...r.messages.map(m=>iso(m.createdAt)+' — '+m.author+': '+m.body),'','SHA-256 do registro estruturado: '+report.checksum].join('\n');
}
