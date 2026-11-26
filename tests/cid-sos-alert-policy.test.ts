import assert from 'node:assert/strict';
import {test} from 'node:test';
import {planCidSosAlert,planCidSosOwnerSafe,publicCidSosCapability,CID_SOS_MIN_INTERVAL_MS,CID_SOS_DAY_LIMIT} from '../server/identity/cidSosAlertPolicy';
import {normalizeCidSosRequest,CID_SOS_NOTICE,CID_SOS_MAX_CONTACTS,CID_SOS_CHAT_GREETING} from '../shared/cidSosRequest';

const now=Date.UTC(2026,10,26,12);
const participant=(id:string,n:number)=>({id,channels:[
 {channel:'email' as const,address:id+'@example.invalid',verifiedAt:now-1000,consent:true},
 {channel:'whatsapp' as const,address:'+551199999000'+n,verifiedAt:now-1000,consent:true},
 {channel:'sms' as const,address:'+551199999000'+n,verifiedAt:now-1000,consent:true}
]});
const owner=participant('owner-test',1),contact=participant('contact-test',2);
const profile={tagId:'a'.repeat(32),ownerId:owner.id,displayName:'Pessoa de teste',active:true,enabled:true,owner,contacts:[contact,participant('contact-b',3),participant('contact-c',4)]};
const request={id:'b'.repeat(32),confirmed:true,reason:'Animal encontrado',sms:false};

test('reason, optional SMS and explicit location consent; no arbitrary technical data',()=>{
 assert.deepEqual(normalizeCidSosRequest(request),request);
 for(const bad of [{...request,confirmed:false},{...request,reason:' '},{...request,reason:'x'.repeat(501)},{...request,sms:undefined},{...request,ip:'1.2.3.4'},{...request,location:{latitude:0,longitude:0,accuracy:15,consent:false}},{...request,location:{latitude:100,longitude:0,accuracy:15,consent:true}}])assert.throws(()=>normalizeCidSosRequest(bad));
 assert.ok(CID_SOS_NOTICE.includes('autoridades competentes'));
 assert.ok(CID_SOS_CHAT_GREETING.includes('explique a situação'));
 assert.equal(CID_SOS_MAX_CONTACTS,3);
});
test('three contacts and mandatory owner copy, SMS explicitly optional',()=>{
 const result=planCidSosAlert(profile,request,now,[]);
 assert.equal(result.duplicate,false);
 assert.equal(result.messages.length,8);
 assert.equal(result.messages.filter(m=>m.recipient.role==='owner').length,2);
 assert.ok(result.messages.every(m=>m.recipient.channel!=='sms'));
 assert.equal(new Set(result.messages.map(m=>m.key)).size,8);
 assert.ok(result.messages.every(m=>m.text.includes('26/11/2026')&&m.text.includes('09:00')));
 assert.equal(result.occurrence.reason,request.reason);
 assert.ok(!result.messages.some(m=>m.text.includes(request.reason)));
 assert.deepEqual(publicCidSosCapability(profile,now),{available:true,smsAvailable:true});
 const withSms=planCidSosAlert(profile,{...request,sms:true,location:{latitude:0,longitude:0,accuracy:10,consent:true}},now,[]);
 assert.equal(withSms.messages.length,12);
 assert.equal(withSms.messages.filter(m=>m.recipient.channel==='sms').length,4);
 assert.equal(withSms.occurrence.location?.accuracy,10);
});
test('inactive, unverified, nonconsenting and duplicate recipients fail closed',()=>{
 for(const p of [{...profile,active:false},{...profile,enabled:false},{...profile,owner:{...owner,channels:owner.channels.map(c=>({...c,verifiedAt:0}))}},{...profile,contacts:[]},{...profile,contacts:[...profile.contacts,participant('fourth',5)]},{...profile,contacts:[owner]},{...profile,contacts:[{...contact,channels:contact.channels.map(c=>({...c,consent:false}))}]}]){
  assert.throws(()=>planCidSosAlert(p,request,now,[]));
  assert.deepEqual(publicCidSosCapability(p,now),{available:false,smsAvailable:false});
 }
});
test('idempotence and proposed interval and daily limits',()=>{
 const first=planCidSosAlert(profile,request,now,[]);
 assert.deepEqual(planCidSosAlert(profile,request,now,[first.occurrence]).messages,[]);
 const next={...request,id:'c'.repeat(32)};
 assert.throws(()=>planCidSosAlert(profile,next,now+1000,[first.occurrence]));
 const history=Array.from({length:CID_SOS_DAY_LIMIT},(_,i)=>({...first.occurrence,id:String(i).repeat(32),createdAt:now-(i+1)*CID_SOS_MIN_INTERVAL_MS}));
 assert.throws(()=>planCidSosAlert(profile,next,now,history));
});
test('only verified owner may mark safe; only actually notified and still-consenting channels',()=>{
 const {occurrence,messages}=planCidSosAlert(profile,request,now,[]);
 const delivered=messages.filter(m=>m.recipient.participantId===contact.id).map(m=>m.key);
 assert.throws(()=>planCidSosOwnerSafe(occurrence,'visitor',now+1000,delivered,profile));
 const changed={...profile,contacts:[{...contact,channels:contact.channels.filter(c=>c.channel!=='whatsapp')}]};
 const resolved=planCidSosOwnerSafe(occurrence,owner.id,now+1000,delivered,changed);
 assert.equal(resolved.occurrence.status,'owner-safe');
 assert.equal(resolved.messages.length,1);
 assert.equal(resolved.messages[0].recipient.channel,'email');
 assert.deepEqual(planCidSosOwnerSafe(resolved.occurrence,owner.id,now+2000,delivered,changed).messages,[]);
 assert.deepEqual(planCidSosOwnerSafe(occurrence,owner.id,now+1000,[],profile).messages,[]);
});
