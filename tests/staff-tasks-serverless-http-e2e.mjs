import assert from 'node:assert/strict';
import { createSign, generateKeyPairSync } from 'node:crypto';
import { once } from 'node:events';
import express from 'express';
import handler from '../api/health.ts';
import { adminDb } from '../server/firebaseAdmin.ts';

const projectId = 'kyrub-security-test';
assert.match(process.env.FIRESTORE_EMULATOR_HOST ?? '', /^(127\.0\.0\.1|localhost):\d+$/);
assert.equal(process.env.FIREBASE_PROJECT_ID, projectId);
assert.notEqual(process.env.VERCEL_ENV, 'production');
const ownerId = 'task_test_owner';
const canonical = 'task_test_store';
const manager = 'task_test_manager';
const cashier = 'task_test_cashier';
const seller = 'task_test_seller';
const suspended = 'task_test_suspended';
const outsider = 'task_test_outsider';
const taskId = 'task_request_123456789';
const {privateKey, publicKey} = generateKeyPairSync('rsa', {
  modulusLength: 2048,
  privateKeyEncoding: {type:'pkcs8',format:'pem'},
  publicKeyEncoding: {type:'spki',format:'pem'},
});
const kid = 'staff-tasks-emulated';
const certificateUrl = 'https://www.googleapis.com/robot/v1/metadata/x509/securetoken@system.gserviceaccount.com';
const realFetch = globalThis.fetch;
globalThis.fetch = (resource, options) => {
  const url = resource instanceof URL ? resource.href : typeof resource === 'string' ? resource : resource.url;
  if (url === certificateUrl) return Promise.resolve(new Response(JSON.stringify({[kid]:publicKey}),{
    status:200,headers:{'cache-control':'max-age=60','content-type':'application/json'},
  }));
  if (url.startsWith('https://')) throw Error('EXTERNAL_HTTP_BLOCKED');
  return realFetch(resource,options);
};
const now = Math.floor(Date.now()/1000);
const signed = (uid, project=projectId) => {
  const head = Buffer.from(JSON.stringify({alg:'RS256',kid,typ:'JWT'})).toString('base64url');
  const claims = Buffer.from(JSON.stringify({
    aud:project,iss:'https://securetoken.google.com/'+project,
    sub:uid,iat:now,exp:now+1800,auth_time:now,
  })).toString('base64url');
  const raw = head+'.'+claims;
  return raw+'.'+createSign('RSA-SHA256').update(raw).sign(privateKey,'base64url');
};
const ids=[ownerId,manager,cashier,seller,suspended,outsider];
const tokens=Object.fromEntries(ids.map(id=>[id,signed(id)]));
const app=express();
app.use(express.json({limit:'32kb'}));
app.all('/api/health', async (req,res)=>{await handler(req,res);});
const server=app.listen(0,'127.0.0.1');
await once(server,'listening');
const origin='http://127.0.0.1:'+server.address().port;
const member=(uid,role,status='active')=>({
  storeId:canonical,userId:uid,role,status,invitedBy:ownerId,acceptedAt:new Date().toISOString(),
});
const call=async(action,{uid,method='GET',body,token}={})=>{
  const params=new URLSearchParams({transport:'staff-tasks'});
  if(action)params.set('path',action);
  if(method==='GET')params.set('storeId',ownerId);
  const res=await realFetch(origin+'/api/health?'+params,{
    method,headers:{
      ...(uid||token?{authorization:'Bearer '+(token||tokens[uid])}:{}),
      ...(body?{'content-type':'application/json'}:{}),
    },
    ...(body?{body:JSON.stringify({storeId:ownerId,...body})}:{}),
  });
  return {status:res.status,payload:await res.json()};
};
const list=uid=>call('',{uid});
const create=(uid,body)=>call('',{uid,method:'POST',body});
const step=(uid,body)=>call('step',{uid,method:'POST',body});
const assignees=uid=>call('assignees',{uid});
try {
  await Promise.all([
    adminDb.doc('tenants/'+ownerId).set({canonicalStoreId:canonical}),
    adminDb.doc('stores/'+canonical).set({id:canonical,ownerId}),
    adminDb.doc('stores/'+canonical+'/members/'+manager).set(member(manager,'manager')),
    adminDb.doc('stores/'+canonical+'/members/'+cashier).set(member(cashier,'cashier')),
    adminDb.doc('stores/'+canonical+'/members/'+seller).set(member(seller,'seller')),
    adminDb.doc('stores/'+canonical+'/members/'+suspended).set(member(suspended,'seller','suspended')),
  ]);
  assert.equal((await list()).status,401);
  assert.equal((await list(outsider)).status,403);
  assert.equal((await list(suspended)).status,403);
  assert.equal((await call('',{token:signed(cashier,'other-project')})).status,401);
  assert.equal((await assignees(cashier)).status,403);
  const choices=await assignees(manager);
  assert.equal(choices.status,200,JSON.stringify(choices));
  assert.ok(choices.payload.assignees.some(a=>a.userId===seller));
  assert.ok(!choices.payload.assignees.some(a=>a.userId===suspended));

  const creation={
    requestId:taskId,title:'Checklist de abertura',details:'Antes do atendimento',
    assignedTo:seller,dueDate:'2026-12-10',
    steps:['Verificar equipamentos','Organizar o balcão'],
  };
  assert.equal((await create(seller,creation)).status,403);
  assert.equal((await create(manager,{...creation,assignedTo:outsider,requestId:'task_invalid_assignee_123'})).status,400);
  assert.equal((await create(manager,{...creation,assignedTo:suspended,requestId:'task_suspended_assignee_123'})).status,400);
  const first=await create(manager,creation);
  assert.equal(first.status,200,JSON.stringify(first));
  assert.equal(first.payload.task.version,1);
  assert.equal(first.payload.task.status,'open');
  assert.equal((await create(manager,creation)).status,200);
  assert.equal((await create(manager,{...creation,title:'Outra tarefa'})).status,409);
  assert.equal((await list(seller)).payload.tasks.length,1);
  assert.equal((await list(cashier)).payload.tasks.length,0);
  assert.equal((await list(manager)).payload.tasks.length,1);
  assert.equal((await list(ownerId)).payload.tasks.length,1);
  assert.equal((await adminDb.collection('users/'+seller+'/notifications').get()).size,1);
  assert.equal((await adminDb.collection('users/'+cashier+'/notifications').get()).size,0);
  assert.equal((await adminDb.collection('users/'+suspended+'/notifications').get()).size,0);

  const s1={taskId,stepId:'1',completed:true,expectedVersion:1,requestId:'task_step_action_first_123'};
  assert.equal((await step(cashier,s1)).status,404);
  assert.equal((await step(manager,s1)).status,404);
  const updated=await step(seller,s1);
  assert.equal(updated.status,200,JSON.stringify(updated));
  assert.equal(updated.payload.task.version,2);
  assert.equal(updated.payload.task.steps[0].completedBy,seller);
  assert.equal((await step(seller,s1)).status,200);
  assert.equal((await step(seller,{...s1,completed:false})).status,409);
  const stale={taskId,stepId:'2',completed:true,expectedVersion:1,requestId:'task_step_action_second_123'};
  assert.equal((await step(seller,stale)).status,409);
  const done=await step(seller,{...stale,expectedVersion:2});
  assert.equal(done.status,200,JSON.stringify(done));
  assert.equal(done.payload.task.status,'done');
  assert.equal(done.payload.task.version,3);
  assert.ok(done.payload.task.completedAt);
  const reopen=await step(seller,{
    taskId,stepId:'2',completed:false,expectedVersion:3,requestId:'task_step_reopen_action_123',
  });
  assert.equal(reopen.status,200);
  assert.equal(reopen.payload.task.status,'open');
  assert.equal(reopen.payload.task.completedAt,'');
  assert.equal((await adminDb.collection('stores/'+canonical+'/staffTasks').get()).size,1);
  assert.equal((await adminDb.collection('stores/'+canonical+'/staffTasks/'+taskId+'/history').get()).size,3);
  assert.equal((await adminDb.collection('stores/'+canonical+'/timeClockEntries').get()).size,0);
  assert.equal((await adminDb.collection('stores/'+canonical+'/payments').get()).size,0);

  // Revoked membership must immediately invalidate step writes and reads.
  await adminDb.doc('stores/'+canonical+'/members/'+seller).update({status:'suspended'});
  assert.equal((await list(seller)).status,403);
  assert.equal((await step(seller,{
    taskId,stepId:'1',completed:false,expectedVersion:4,requestId:'task_after_suspended_123',
  })).status,403);
  console.log('STAFF_TASKS_HTTP_FIRESTORE_E2E_PASS');
} finally {
  globalThis.fetch=realFetch;
  await new Promise(resolve=>server.close(resolve));
}
