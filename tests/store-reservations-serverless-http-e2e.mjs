import assert from 'node:assert/strict';
import { createSign,generateKeyPairSync } from 'node:crypto';
import { once } from 'node:events';
import express from 'express';
import handler from '../api/health.ts';
import {adminDb} from '../server/firebaseAdmin.ts';

const projectId='kyrub-security-test';
assert.match(process.env.FIRESTORE_EMULATOR_HOST??'',/^(127\.0\.0\.1|localhost):\d+$/);
assert.equal(process.env.FIREBASE_PROJECT_ID,projectId);
assert.notEqual(process.env.VERCEL_ENV,'production');
const owner='booking_owner_test';
const canonical='booking_canonical_test';
const manager='booking_manager_test';
const seller='booking_seller_test';
const suspended='booking_suspended_test';
const outsider='booking_outsider_test';
const {privateKey,publicKey}=generateKeyPairSync('rsa',{
  modulusLength:2048,
  privateKeyEncoding:{type:'pkcs8',format:'pem'},
  publicKeyEncoding:{type:'spki',format:'pem'},
});
const kid='store-reservations-isolated';
const certUrl='https://www.googleapis.com/robot/v1/metadata/x509/securetoken@system.gserviceaccount.com';
const originalFetch=globalThis.fetch;
globalThis.fetch=(resource,opts)=>{
  const url=resource instanceof URL?resource.href:typeof resource==='string'?resource:resource.url;
  if(url===certUrl)return Promise.resolve(new Response(JSON.stringify({[kid]:publicKey}),{
    status:200,headers:{'cache-control':'max-age=60','content-type':'application/json'},
  }));
  if(url.startsWith('https://'))throw Error('EXTERNAL_HTTP_BLOCKED');
  return originalFetch(resource,opts);
};
const now=Math.floor(Date.now()/1000);
const signed=uid=>{
  const head=Buffer.from(JSON.stringify({alg:'RS256',kid,typ:'JWT'})).toString('base64url');
  const payload=Buffer.from(JSON.stringify({
    aud:projectId,iss:'https://securetoken.google.com/'+projectId,
    sub:uid,iat:now,exp:now+3600,auth_time:now,
  })).toString('base64url');
  const raw=head+'.'+payload;
  return raw+'.'+createSign('RSA-SHA256').update(raw).sign(privateKey,'base64url');
};
const tokens=Object.fromEntries([owner,manager,seller,suspended,outsider].map(id=>[id,signed(id)]));
const app=express();
app.use(express.json({limit:'32kb'}));
app.all('/api/health',async(req,res)=>{await handler(req,res);});
const server=app.listen(0,'127.0.0.1');
await once(server,'listening');
const origin='http://127.0.0.1:'+server.address().port;
const request=async(path,{uid,method='GET',body}={})=>{
  const query=new URLSearchParams({transport:'store-reservations',path});
  if(method==='GET')query.set('storeId',owner);
  const response=await originalFetch(origin+'/api/health?'+query.toString(),{
    method,headers:{
      ...(uid?{authorization:'Bearer '+tokens[uid]}:{}),
      ...(body?{'content-type':'application/json'}:{}),
    },
    ...(body?{body:JSON.stringify({storeId:owner,...body})}:{}),
  });
  return {status:response.status,data:await response.json()};
};
const booking=(uid,body)=>request('',{uid,method:'POST',body});
const setting=(uid,enabled)=>request('settings',{uid,method:'POST',body:{enabled}});
const publicStore=async()=>{
  const response=await originalFetch(origin+'/api/health?transport=public-storefront&slug=teste-reservas');
  return {status:response.status,data:await response.json()};
};
const member=(uid,role,status='active')=>({
  storeId:canonical,userId:uid,role,status,
  invitedBy:owner,acceptedAt:new Date().toISOString(),
});
try{
  await Promise.all([
    adminDb.doc('tenants/'+owner).set({id:owner,slug:'teste-reservas',canonicalStoreId:canonical}),
    adminDb.doc('stores/'+canonical).set({id:canonical,ownerId:owner}),
    adminDb.doc('stores/'+canonical+'/members/'+manager).set(member(manager,'manager')),
    adminDb.doc('stores/'+canonical+'/members/'+seller).set(member(seller,'seller')),
    adminDb.doc('stores/'+canonical+'/members/'+suspended).set(member(suspended,'seller','suspended')),
    adminDb.doc('marketplace_listings/'+owner).set({
      listingType:'store',storeId:owner,ownerId:owner,slug:'teste-reservas',
      name:'Loja Teste Reservas',description:'Agendamentos de teste',
      logo:'',banner:'',primaryColor:'#f97316',address:'',contact:'privado@example.com',
      keywords:[],status:'open',publicationStatus:'published',
    }),
  ]);
  const initial=await publicStore();
  assert.equal(initial.status,200,JSON.stringify(initial));
  assert.equal(initial.data.store.reservationsEnabled,false);
  assert.equal('contact' in initial.data.store,false,'Private contact must never be projected');

  assert.equal((await request('settings')).status,401);
  assert.equal((await request('settings',{uid:outsider})).status,403);
  assert.equal((await request('settings',{uid:suspended})).status,403);
  assert.equal((await setting(seller,true)).status,403);
  assert.equal((await setting(outsider,true)).status,403);
  assert.equal((await setting(manager,'yes')).status,400);

  // Internal ERP records do not activate the public booking offer.
  const b=await booking(owner,{
    clientName:'Cliente Interno',scheduledAt:'2026-12-04T13:00:00',people:2,
  });
  assert.equal(b.status,201,JSON.stringify(b));
  assert.equal((await request('',{uid:owner})).data.reservations.length,1);
  assert.equal((await publicStore()).data.store.reservationsEnabled,false);

  const enabled=await setting(manager,true);
  assert.equal(enabled.status,200,JSON.stringify(enabled));
  assert.equal(enabled.data.enabled,true);
  assert.equal((await request('settings',{uid:owner})).data.enabled,true);
  assert.equal((await publicStore()).data.store.reservationsEnabled,true);
  const repeat=await setting(manager,true);
  assert.equal(repeat.status,200);
  const config=await adminDb.doc('stores/'+canonical+'/settings/reservations').get();
  assert.equal(config.get('version'),1);
  assert.equal(config.get('updatedBy'),manager);

  const done=await request(b.data.id+'/complete',{uid:owner,method:'POST',body:{}});
  assert.equal(done.status,200,JSON.stringify(done));
  assert.equal(done.data.updated,true);
  const replay=await request(b.data.id+'/complete',{uid:owner,method:'POST',body:{}});
  assert.equal(replay.status,200);
  assert.equal(replay.data.updated,false);

  const disabled=await setting(owner,false);
  assert.equal(disabled.status,200);
  assert.equal((await publicStore()).data.store.reservationsEnabled,false);
  assert.equal((await adminDb.collection('stores/'+canonical+'/reservations').get()).size,1,
    'Disabling public offer must preserve reservation history');
  assert.equal((await adminDb.collection('stores/'+canonical+'/payments').get()).size,0);
  console.log('STORE_RESERVATIONS_VISIBILITY_E2E_PASS');
} finally {
  globalThis.fetch=originalFetch;
  await new Promise(resolve=>server.close(resolve));
}
