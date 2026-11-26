import assert from 'node:assert/strict';
import {test} from 'node:test';
import {prepareCidSosConfig,projectPublicCidSos,type ChannelGrant} from '../server/identity/cidSosPrivateConfig';
import {recordSimulatedCidSos,type PrivateSosStore,type PendingSosMessage} from '../server/identity/cidSosOccurrenceStore';
import {createCidOccurrenceChat,issueCidChatInvite,redeemCidChatInvite,openCidChatSession,prepareCidChatMessage,closeCidChat,projectCidChat} from '../server/identity/cidOccurrenceChatAccess';
import {observeCidAccess,observeCidVoluntaryLocation,projectOwnerAssistedLocation} from '../server/identity/cidAssistedLocation';
import {prepareCidOccurrenceReport,formatCidConversationText} from '../server/identity/cidOccurrenceReport';
import {requestCidEvidencePreservation} from '../server/identity/cidEvidencePreservation';
import {classifyCidOccurrence,assessCidReturnMessage} from '../server/identity/cidOccurrenceGuidance';
import type {CidSosOccurrence} from '../server/identity/cidSosAlertPolicy';

test('simulated end-to-end domain workflow without account, provider, production database or GPS permission',async()=>{
 const now=Date.UTC(2026,10,26,12);
 const tag={tagId:'a'.repeat(32),ownerId:'owner-test',displayName:'CID de teste',active:true};
 const person=(id:string,n:number)=>({id,name:id,channels:[{channel:'email',address:id+'@example.invalid'},{channel:'sms',address:'+551199999000'+n}]});
 const config=prepareCidSosConfig(tag,tag.ownerId,null,{expectedRevision:0,enabled:true,owner:person(tag.ownerId,1),contacts:[person('contact-a',2),person('contact-b',3),person('contact-c',4)]});
 const grants:ChannelGrant[]=[config.owner,...config.contacts].flatMap(p=>p.channels.map(c=>({...c,tagId:tag.tagId,ownerId:tag.ownerId,participantId:p.id,verifiedAt:now-1000,consent:true})));
 assert.deepEqual(projectPublicCidSos(tag,config,[],now),{available:false,smsAvailable:false});
 assert.deepEqual(projectPublicCidSos(tag,config,grants,now),{available:true,smsAvailable:true});

 let occurrences:CidSosOccurrence[]=[],pending:PendingSosMessage[]=[];
 const store:PrivateSosStore={async transaction(work){
  const nextOccurrences=structuredClone(occurrences),nextPending=structuredClone(pending);
  const result=await work({readTag:async()=>tag,readConfig:async()=>config,readGrants:async()=>grants,
   readOccurrence:async id=>nextOccurrences.find(r=>r.id===id)??null,
   readRecent:async(id,after)=>nextOccurrences.filter(r=>r.tagId===id&&r.createdAt>=after),
   createOccurrence:async record=>{nextOccurrences.push(record);},
   createPendingMessage:async entry=>{nextPending.push(entry);}});
  occurrences=nextOccurrences;pending=nextPending;return result;
 }};
 const input={id:'b'.repeat(32),confirmed:true,reason:'Animal encontrado',sms:false,location:{latitude:0,longitude:0,accuracy:25,consent:true}};
 assert.deepEqual(await recordSimulatedCidSos(store,tag.tagId,input,now),{accepted:true,simulated:true});
 await recordSimulatedCidSos(store,tag.tagId,input,now);
 assert.equal(occurrences.length,1);
 assert.equal(pending.length,4);assert.equal(pending.filter(p=>p.message.recipient.role==='owner').length,1);
 assert.ok(pending.every(p=>p.status==='simulation-pending'&&p.message.recipient.channel==='email'));
 const occurrence=occurrences[0];
 const {chat,greeting}=createCidOccurrenceChat(occurrence,'emitter-test',now);
 assert.equal(chat.members.length,5);
 const owner=openCidChatSession(chat,tag.ownerId,'owner-passkey',now);
 const emitter=openCidChatSession(chat,'emitter-test','emitter-session',now);
 const invite=issueCidChatInvite(chat,'contact-a',now);
 assert.throws(()=>redeemCidChatInvite(chat,invite.record,invite.secret,'contact-b',now));
 const contact=redeemCidChatInvite(chat,invite.record,invite.secret,'contact-a',now+1).session;
 assert.equal(projectCidChat(chat,contact.record,contact.secret,now+1).role,'contact');
 const message=prepareCidChatMessage(chat,emitter.record,emitter.secret,{id:'msg-a',body:'Só devolvo o cachorro se pagar 500 reais'},now+2);
 const reply=prepareCidChatMessage(chat,owner.record,owner.secret,{id:'msg-b',body:'Vamos combinar uma devolução segura.'},now+3);
 assert.equal(classifyCidOccurrence(occurrence.reason).category,'animal-found');
 assert.equal(assessCidReturnMessage(message.body,'owner')?.kind,'possible-conditional-payment');
 assert.equal(assessCidReturnMessage(message.body,'contact'),null);
 const location=observeCidVoluntaryLocation(tag,occurrence)!;
 const view=projectOwnerAssistedLocation(tag,tag.ownerId,[observeCidAccess(tag,now),location],now+3);
 assert.equal(view.shared?.point.accuracy,25);assert.equal(view.device,null);
 assert.throws(()=>projectOwnerAssistedLocation(tag,'emitter-test',[location],now+3));
 const closed=closeCidChat(chat,owner.record,owner.secret,now+4);
 assert.throws(()=>prepareCidChatMessage(closed,emitter.record,emitter.secret,{id:'msg-c',body:'texto'},now+5));
 const report=prepareCidOccurrenceReport(closed,owner.record,owner.secret,occurrence,[greeting,message,reply],now+5);
 assert.equal(report.content.closedAt,now+4);
 assert.equal(report.content.messages.length,3);
 assert.equal(report.content.location?.accuracy,25);
 assert.match(formatCidConversationText(report),/devolução segura/);
 assert.ok(!JSON.stringify(report).includes('@example.invalid'));
 assert.ok(!JSON.stringify(report).includes(owner.record.digest));
 assert.equal(requestCidEvidencePreservation(closed,owner.record,owner.secret,'Preservar conversa',now+6).status,'pending-review');
 assert.throws(()=>prepareCidOccurrenceReport(closed,contact.record,contact.secret,occurrence,[greeting],now+6));
});
