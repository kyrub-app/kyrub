import assert from 'node:assert/strict';
import {test} from 'node:test';
import {planCidSosAlert,planCidSosOwnerSafe,publicCidSosCapability,CID_SOS_MIN_INTERVAL_MS,CID_SOS_DAY_LIMIT} from '../server/identity/cidSosAlertPolicy';

const now=Date.UTC(2026,10,26,12);
const owner={phone:'+5511999990001',verifiedAt:now-1000,consent:true};
const contact={phone:'+5511999990002',verifiedAt:now-1000,consent:true};
const profile={tagId:'a'.repeat(32),ownerId:'owner-test',active:true,enabled:true,owner,contacts:[contact]};
const request={id:'b'.repeat(32),confirmed:true};

test('confirmed alert plans one private owner copy and every verified contact',()=>{
 const result=planCidSosAlert(profile,request,now,[]);
 assert.equal(result.duplicate,false);
 assert.deepEqual(result.messages.map(m=>m.phone),[owner.phone,contact.phone]);
 assert.equal(new Set(result.messages.map(m=>m.key)).size,2);
 assert.ok(result.messages.every(m=>m.kind==='alert'));
 assert.deepEqual(publicCidSosCapability(profile,now),{available:true});
});
test('unconfirmed, inactive, unverified, nonconsenting and duplicate recipients fail closed',()=>{
 assert.throws(()=>planCidSosAlert(profile,{...request,confirmed:false},now,[]));
 for(const p of [{...profile,active:false},{...profile,enabled:false},{...profile,owner:{...owner,verifiedAt:0}},{...profile,owner:{...owner,consent:false}},{...profile,contacts:[{...contact,consent:false}]},{...profile,contacts:[]},{...profile,contacts:[owner]}]){
  assert.throws(()=>planCidSosAlert(p,request,now,[]));
  assert.deepEqual(publicCidSosCapability(p,now),{available:false});
 }
});
test('duplicate requests never plan another send; interval and daily limits reject new requests',()=>{
 const first=planCidSosAlert(profile,request,now,[]);
 assert.deepEqual(planCidSosAlert(profile,request,now,[first.occurrence]).messages,[]);
 const next={id:'c'.repeat(32),confirmed:true};
 assert.throws(()=>planCidSosAlert(profile,next,now+1000,[first.occurrence]));
 assert.throws(()=>planCidSosAlert({...profile,ownerId:'other'},request,now,[first.occurrence]));
 const history=Array.from({length:CID_SOS_DAY_LIMIT},(_,i)=>({...first.occurrence,id:String(i).repeat(32),createdAt:now-(i+1)*CID_SOS_MIN_INTERVAL_MS}));
 assert.throws(()=>planCidSosAlert(profile,next,now,history));
});
test('only verified owner may mark safe; notify original contacts exactly once',()=>{
 const {occurrence}=planCidSosAlert(profile,request,now,[]);
 assert.throws(()=>planCidSosOwnerSafe(occurrence,'visitor',now+1000));
 const resolved=planCidSosOwnerSafe(occurrence,profile.ownerId,now+1000);
 assert.equal(resolved.occurrence.status,'owner-safe');
 assert.deepEqual(resolved.messages.map(m=>m.phone),[contact.phone]);
 assert.equal(resolved.messages[0].kind,'owner-safe');
 assert.deepEqual(planCidSosOwnerSafe(resolved.occurrence,profile.ownerId,now+2000).messages,[]);
});
