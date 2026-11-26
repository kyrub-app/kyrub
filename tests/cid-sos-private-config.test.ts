import assert from 'node:assert/strict';
import {test} from 'node:test';
import {prepareCidSosConfig,projectPublicCidSos,readPrivateCidSosConfig,type ChannelGrant} from '../server/identity/cidSosPrivateConfig';
import {recordSimulatedCidSos,type PrivateSosStore,type PendingSosMessage} from '../server/identity/cidSosOccurrenceStore';
import type {CidSosOccurrence} from '../server/identity/cidSosAlertPolicy';
const now=Date.UTC(2026,10,26,12),tag={tagId:'a'.repeat(32),ownerId:'owner-test',displayName:'Pessoa de teste',active:true};
const person=(id:string)=>({id,name:id,channels:[{channel:'email',address:id+'@example.invalid'}]});
const draft={expectedRevision:0,enabled:true,owner:person(tag.ownerId),contacts:[person('contact-a'),person('contact-b'),person('contact-c')]};
const config=prepareCidSosConfig(tag,tag.ownerId,null,draft);
const grants:ChannelGrant[]=[config.owner,...config.contacts].flatMap(p=>p.channels.map(c=>({...c,tagId:tag.tagId,ownerId:tag.ownerId,participantId:p.id,verifiedAt:now-1000,consent:true})));
const request={id:'b'.repeat(32),confirmed:true,reason:'Animal encontrado',sms:false};
test('only verified owner can prepare/read private configuration; max three contacts and optimistic revision',()=>{
 assert.equal(config.revision,1);
 assert.equal(config.contacts.length,3);
 assert.throws(()=>prepareCidSosConfig(tag,'visitor',null,draft));
 assert.throws(()=>readPrivateCidSosConfig(tag,'visitor',config));
 assert.deepEqual(readPrivateCidSosConfig(tag,tag.ownerId,config),config);
 assert.throws(()=>prepareCidSosConfig(tag,tag.ownerId,config,draft),/CONFLICT/);
 assert.throws(()=>prepareCidSosConfig(tag,tag.ownerId,null,{...draft,contacts:[...draft.contacts,person('fourth')]}));
 assert.throws(()=>prepareCidSosConfig(tag,tag.ownerId,null,{...draft,contacts:[draft.owner]}));
 assert.throws(()=>prepareCidSosConfig(tag,tag.ownerId,null,{...draft,contacts:[{...person('other'),channels:[{channel:'email',address:config.owner.channels[0].address}]}]}));
 assert.throws(()=>prepareCidSosConfig(tag,tag.ownerId,null,{...draft,contacts:[{...person('other'),channels:[{channel:'email',address:'other@example.invalid',verifiedAt:now,consent:true}]}]}));
});
test('public projection does not expose names or addresses; requires independent current grants',()=>{
 const enabled={available:true,smsAvailable:false},disabled={available:false,smsAvailable:false};
 assert.deepEqual(projectPublicCidSos(tag,config,grants,now),enabled);
 assert.deepEqual(projectPublicCidSos(tag,config,[],now),disabled);
 assert.deepEqual(projectPublicCidSos(tag,config,grants.map(g=>({...g,tagId:'c'.repeat(32)})),now),disabled);
 assert.deepEqual(projectPublicCidSos(tag,config,[...grants,{...grants[0],revokedAt:now}],now),disabled);
 assert.deepEqual(projectPublicCidSos(tag,config,grants.map((g,i)=>i?g:{...g,revokedAt:now}),now),disabled);
 assert.deepEqual(projectPublicCidSos({...tag,active:false},config,grants,now),disabled);
 const changed=prepareCidSosConfig(tag,tag.ownerId,config,{...draft,expectedRevision:1,owner:{...draft.owner,channels:[{channel:'email',address:'new@example.invalid'}]}});
 assert.deepEqual(projectPublicCidSos(tag,changed,grants,now),disabled);
});
test('simulation records occurrence and private queue together, with no repeated sends or leaked details',async()=>{
 let records:CidSosOccurrence[]=[],pending:PendingSosMessage[]=[];
 let rejectWrite=false;
 const store:PrivateSosStore={async transaction(work){
  const nextRecords=structuredClone(records),nextPending=structuredClone(pending);
  const result=await work({
   readTag:async()=>tag,readConfig:async()=>config,readGrants:async()=>grants,
   readOccurrence:async id=>nextRecords.find(r=>r.id===id)??null,
   readRecent:async(id,after)=>nextRecords.filter(r=>r.tagId===id&&r.createdAt>=after),
   createOccurrence:async record=>{nextRecords.push(record);},
   createPendingMessage:async message=>{if(rejectWrite)throw Error('simulated failure');nextPending.push(message);}
  });
  records=nextRecords;pending=nextPending;return result;
 }};
 rejectWrite=true;await assert.rejects(recordSimulatedCidSos(store,tag.tagId,request,now));
 assert.equal(records.length,0);assert.equal(pending.length,0);
 rejectWrite=false;
 assert.deepEqual(await recordSimulatedCidSos(store,tag.tagId,request,now),{accepted:true,simulated:true});
 assert.equal(records.length,1);assert.equal(pending.length,4);
 assert.ok(pending.every(p=>p.status==='simulation-pending'));
 await recordSimulatedCidSos(store,tag.tagId,request,now);
 assert.equal(records.length,1);assert.equal(pending.length,4);
 await assert.rejects(recordSimulatedCidSos(store,tag.tagId,{...request,id:'c'.repeat(32)},now+1000));
 assert.equal(pending.length,4);
});
