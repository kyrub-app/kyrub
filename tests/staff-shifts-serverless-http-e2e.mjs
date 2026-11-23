import assert from 'node:assert/strict';
import {createSign,generateKeyPairSync} from 'node:crypto';
import {once} from 'node:events';
import express from 'express';
import handler from '../api/health.ts';
import {adminDb} from '../server/firebaseAdmin.ts';

const projectId='kyrub-security-test';
assert.match(process.env.FIRESTORE_EMULATOR_HOST??'',/^(127\.0\.0\.1|localhost):\d+$/);
assert.equal(process.env.FIREBASE_PROJECT_ID,projectId);
assert.notEqual(process.env.VERCEL_ENV,'production');
const ownerId='shifts_owner_test';
const canonical='shifts_canonical_test';
const manager='shifts_manager_test';
const seller='shifts_seller_test';
const cashier='shifts_cashier_test';
const suspended='shifts_suspended_test';
const outsider='shifts_outsider_test';
const shiftId='shift_overnight_request_12345';
const {privateKey,publicKey}=generateKeyPairSync('rsa',{
  modulusLength:2048,
  privateKeyEncoding:{type:'pkcs8',format:'pem'},
  publicKeyEncoding:{type:'spki',format:'pem'},
});
const kid='staff-shifts-isolated';
const certificateURL='https://www.googleapis.com/robot/v1/metadata/x509/securetoken@system.gserviceaccount.com';
const originalFetch=globalThis.fetch;
globalThis.fetch=(resource,options)=>{
  const url=resource instanceof URL?resource.href:typeof resource==='string'?resource:resource.url;
  if(url===certificateURL) return Promise.resolve(new Response(JSON.stringify({[kid]:publicKey}),{
    status:200,headers:{'cache-control':'max-age=60','content-type':'application/json'},
  }));
  if(url.startsWith('https://'))throw Error('EXTERNAL_HTTP_BLOCKED');
  return originalFetch(resource,options);
};
const now=Math.floor(Date.now()/1000);
const signed=(uid,project=projectId)=>{
  const head=Buffer.from(JSON.stringify({alg:'RS256',kid,typ:'JWT'})).toString('base64url');
  const claims=Buffer.from(JSON.stringify({
    aud:project,iss:'https://securetoken.google.com/'+project,
    sub:uid,iat:now,exp:now+1800,auth_time:now,
  })).toString('base64url');
  const raw=head+'.'+claims;
  return raw+'.'+createSign('RSA-SHA256').update(raw).sign(privateKey,'base64url');
};
const tokens=Object.fromEntries([ownerId,manager,seller,cashier,suspended,outsider]
  .map(uid=>[uid,signed(uid)]));
const app=express();
app.use(express.json({limit:'32kb'}));
app.all('/api/health',async(req,res)=>{await handler(req,res);});
const server=app.listen(0,'127.0.0.1');
await once(server,'listening');
const origin='http://127.0.0.1:'+server.address().port;
const member=(uid,role,status='active')=>({
  storeId:canonical,userId:uid,role,status,
  invitedBy:ownerId,acceptedAt:new Date().toISOString(),
});
const call=async(action,{uid,method='GET',body,token}={})=>{
  const query=new URLSearchParams({transport:'staff-shifts'});
  if(action)query.set('path',action);
  if(method==='GET')query.set('storeId',ownerId);
  const response=await originalFetch(origin+'/api/health?'+query.toString(),{
    method,headers:{
      ...(uid||token?{authorization:'Bearer '+(token||tokens[uid])}:{}),
      ...(body?{'content-type':'application/json'}:{}),
    },
    ...(body?{body:JSON.stringify({storeId:ownerId,...body})}:{}),
  });
  return {status:response.status,payload:await response.json()};
};
const list=uid=>call('',{uid});
const create=(uid,body)=>call('',{uid,method:'POST',body});
const cancel=(uid,body)=>call('cancel',{uid,method:'POST',body});
const options=uid=>call('assignees',{uid});
try{
  await Promise.all([
    adminDb.doc('tenants/'+ownerId).set({canonicalStoreId:canonical}),
    adminDb.doc('stores/'+canonical).set({id:canonical,ownerId}),
    adminDb.doc('stores/'+canonical+'/members/'+manager).set(member(manager,'manager')),
    adminDb.doc('stores/'+canonical+'/members/'+seller).set(member(seller,'seller')),
    adminDb.doc('stores/'+canonical+'/members/'+cashier).set(member(cashier,'cashier')),
    adminDb.doc('stores/'+canonical+'/members/'+suspended).set(member(suspended,'seller','suspended')),
  ]);
  assert.equal((await list()).status,401);
  assert.equal((await list(outsider)).status,403);
  assert.equal((await list(suspended)).status,403);
  assert.equal((await call('',{token:signed(manager,'not-the-project')})).status,401);
  assert.equal((await options(seller)).status,403);
  const assignees=await options(manager);
  assert.equal(assignees.status,200,JSON.stringify(assignees));
  assert.ok(assignees.payload.assignees.some(x=>x.userId===seller));
  assert.ok(!assignees.payload.assignees.some(x=>x.userId===suspended));

  const overnight={
    requestId:shiftId,kind:'shift',assignedTo:seller,
    scheduledDate:'2026-12-03',startTime:'21:30',endTime:'05:30',
    endsNextDay:true,sector:'Atendimento',notes:'Turno de fechamento',
  };
  assert.equal((await create(seller,overnight)).status,403);
  assert.equal((await create(outsider,overnight)).status,403);
  assert.equal((await create(manager,{
    ...overnight,assignedTo:suspended,requestId:'shift_bad_assignee_12345',
  })).status,400);
  const first=await create(manager,overnight);
  assert.equal(first.status,200,JSON.stringify(first));
  assert.equal(first.payload.shift.version,1);
  assert.equal(first.payload.shift.status,'published');
  assert.equal((await create(manager,overnight)).status,200);
  assert.equal((await create(manager,{...overnight,sector:'Outros'})).status,409);
  assert.equal((await list(seller)).payload.shifts.length,1);
  assert.equal((await list(cashier)).payload.shifts.length,0);
  assert.equal((await list(ownerId)).payload.shifts.length,1);
  assert.equal((await list(manager)).payload.shifts.length,1);
  assert.equal((await adminDb.collection('users/'+seller+'/notifications').get()).size,1);
  assert.equal((await adminDb.collection('users/'+cashier+'/notifications').get()).size,0);

  const overlap=await create(manager,{
    ...overnight,requestId:'shift_overlap_same_date_12345',
    startTime:'22:00',endTime:'23:00',endsNextDay:false,
  });
  assert.equal(overlap.status,409,JSON.stringify(overlap));
  const folga={
    requestId:'shift_folga_first_123456',kind:'day_off',
    assignedTo:seller,scheduledDate:'2026-12-04',
    startTime:'',endTime:'',endsNextDay:false,sector:'',notes:'Descanso',
  };
  assert.equal((await create(manager,folga)).status,409);
  const cashierFolga=await create(ownerId,{
    ...folga,assignedTo:cashier,requestId:'shift_folga_cashier_12345',
  });
  assert.equal(cashierFolga.status,200,JSON.stringify(cashierFolga));
  assert.equal((await create(manager,{
    ...overnight,assignedTo:cashier,scheduledDate:'2026-12-04',
    startTime:'09:00',endTime:'17:00',endsNextDay:false,
    requestId:'shift_folga_conflict_12345',
  })).status,409);
  const touching=await create(manager,{
    ...overnight,scheduledDate:'2026-12-04',
    startTime:'05:30',endTime:'11:00',endsNextDay:false,
    requestId:'shift_nonoverlap_nextday_12345',
  });
  assert.equal(touching.status,200,JSON.stringify(touching));
  assert.equal((await list(seller)).payload.shifts.length,2);

  const cancellation={
    shiftId,requestId:'shift_cancel_request_12345',expectedVersion:1,reason:'Cobertura por outro turno',
  };
  assert.equal((await cancel(seller,cancellation)).status,403);
  assert.equal((await cancel(cashier,cancellation)).status,403);
  const cancelled=await cancel(manager,cancellation);
  assert.equal(cancelled.status,200,JSON.stringify(cancelled));
  assert.equal(cancelled.payload.shift.status,'cancelled');
  assert.equal(cancelled.payload.shift.version,2);
  assert.equal((await cancel(manager,cancellation)).status,200);
  assert.equal((await cancel(manager,{...cancellation,reason:'Outro motivo'})).status,409);
  assert.equal((await cancel(ownerId,{
    ...cancellation,requestId:'shift_cancel_stale_123456',
  })).status,409);
  // Cancelling the overnight shift removes both civil-day occupancy slices.
  assert.equal((await create(manager,{
    ...overnight,requestId:'shift_replacement_after_cancel_12345',
    startTime:'22:00',endTime:'23:00',endsNextDay:false,sector:'Cobertura',
  })).status,200);
  const folgaAfterCancellation=await create(manager,{
    ...folga,scheduledDate:'2026-12-03',
    requestId:'shift_folga_conflict_after_12345',
  });
  assert.equal(folgaAfterCancellation.status,409); // Replacement shift is active.
  const history=await adminDb.collection(
    'stores/'+canonical+'/staffShifts/'+shiftId+'/history'
  ).get();
  assert.equal(history.size,2);
  const days=await adminDb.collection('stores/'+canonical+'/staffScheduleDays').get();
  assert.ok(days.size>=2);
  assert.equal((await adminDb.collection('users/'+seller+'/notifications').get()).size,4);
  assert.equal((await adminDb.collection('users/'+suspended+'/notifications').get()).size,0);
  assert.equal((await adminDb.collection('stores/'+canonical+'/payments').get()).size,0);
  assert.equal((await adminDb.collection('stores/'+canonical+'/timeClockEntries').get()).size,0);

  // Concurrent publications for the same person/day must serialize through
  // their shared day index instead of both succeeding.
  const concurrent=[
    {...overnight,requestId:'shift_concurrent_a_12345',
      scheduledDate:'2027-01-10',startTime:'08:00',endTime:'14:00',endsNextDay:false},
    {...overnight,requestId:'shift_concurrent_b_12345',
      scheduledDate:'2027-01-10',startTime:'09:00',endTime:'12:00',endsNextDay:false},
  ];
  const responses=await Promise.all([create(manager,concurrent[0]),create(ownerId,concurrent[1])]);
  assert.deepEqual(responses.map(x=>x.status).sort(),[200,409],JSON.stringify(responses));

  await adminDb.doc('stores/'+canonical+'/members/'+seller).update({status:'suspended'});
  assert.equal((await list(seller)).status,403);
  assert.equal((await create(manager,{
    ...overnight,scheduledDate:'2027-01-20',requestId:'shift_after_revoked_12345',
  })).status,400);
  const notificationCount=(await adminDb.collection('users/'+seller+'/notifications').get()).size;
  const cancelRevoked=await cancel(manager,{
    shiftId:touching.payload.shift.id,requestId:'shift_cancel_revoked_12345',
    expectedVersion:1,reason:'Vínculo encerrado',
  });
  assert.equal(cancelRevoked.status,200,JSON.stringify(cancelRevoked));
  assert.equal((await adminDb.collection('users/'+seller+'/notifications').get()).size,notificationCount);
  console.log('STAFF_SHIFTS_HTTP_FIRESTORE_E2E_PASS');
} finally {
  globalThis.fetch=originalFetch;
  await new Promise(resolve=>server.close(resolve));
}
