import assert from 'node:assert/strict';
import { createSign, generateKeyPairSync } from 'node:crypto';
import { once } from 'node:events';
import express from 'express';
import handler from '../api/health.ts';
import { adminDb, adminStorage } from '../server/firebaseAdmin.ts';

const projectId = 'kyrub-security-test';
for (const host of [process.env.FIRESTORE_EMULATOR_HOST, process.env.FIREBASE_STORAGE_EMULATOR_HOST]) {
  assert.match(host ?? '', /^(127\.0\.0\.1|localhost):\d+$/, 'Emulator host is mandatory');
}
assert.equal(process.env.FIREBASE_PROJECT_ID, projectId);
assert.notEqual(process.env.VERCEL_ENV, 'production');
const ownerId = 'pop_test_owner';
const canonical = 'pop_test_store';
const manager = 'pop_test_manager';
const seller = 'pop_test_seller';
const cashier = 'pop_test_cashier';
const suspended = 'pop_test_suspended';
const outsider = 'pop_test_outsider';
const popId = 'pop_audit_procedure_123456';
const { privateKey, publicKey } = generateKeyPairSync('rsa', {
  modulusLength: 2048,
  privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
  publicKeyEncoding: { type: 'spki', format: 'pem' },
});
const kid = 'staff-pops-emulated';
const certificateURL = 'https://www.googleapis.com/robot/v1/metadata/x509/securetoken@system.gserviceaccount.com';
const fetchOriginal = globalThis.fetch;
globalThis.fetch = (resource, options) => {
  const url = typeof resource === 'string' ? resource : resource instanceof URL ? resource.href : resource.url;
  if (url === certificateURL) return Promise.resolve(new Response(JSON.stringify({[kid]: publicKey}), {
    status: 200, headers: {'cache-control': 'max-age=60', 'content-type': 'application/json'},
  }));
  if (url.startsWith('https://')) throw Error('EXTERNAL_HTTP_BLOCKED');
  return fetchOriginal(resource, options);
};
const now = Math.floor(Date.now() / 1000);
const token = (uid, proj = projectId) => {
  const head = Buffer.from(JSON.stringify({alg: 'RS256', kid, typ: 'JWT'})).toString('base64url');
  const claims = Buffer.from(JSON.stringify({
    aud: proj, iss: 'https://securetoken.google.com/' + proj, sub: uid,
    iat: now, exp: now + 1800, auth_time: now,
  })).toString('base64url');
  const raw = head + '.' + claims;
  return raw + '.' + createSign('RSA-SHA256').update(raw).sign(privateKey, 'base64url');
};
const tokens = Object.fromEntries(
  [ownerId, manager, seller, cashier, suspended, outsider].map(uid => [uid, token(uid)])
);
const app = express();
app.use(express.json({limit:'2mb'}));
app.all('/api/health', async (req, res) => {await handler(req, res)});
const server = app.listen(0, '127.0.0.1');
await once(server, 'listening');
const origin = 'http://127.0.0.1:' + server.address().port;
const path = '/api/health?transport=staff-pops';
const members = uid => 'stores/' + canonical + '/members/' + uid;
const member = (uid, role, status = 'active') => ({
  storeId: canonical, userId: uid, role, status,
  invitedBy: ownerId, acceptedAt: new Date().toISOString(),
});
const call = async (action, {uid, method='GET', body, query={}, badToken, binary=false}={}) => {
  const params = new URLSearchParams({transport:'staff-pops', ...query});
  if (action) params.set('path', action);
  if (method === 'GET') params.set('storeId', ownerId);
  const res = await fetchOriginal(origin + '/api/health?' + params.toString(), {
    method,
    headers: {
      ...(uid || badToken ? {'authorization': 'Bearer ' + (badToken || tokens[uid])}: {}),
      ...(body ? {'content-type':'application/json'}:{})
    },
    ...(body ? {body: JSON.stringify({storeId:ownerId,...body})}:{})
  });
  const payload = binary ? Buffer.from(await res.arrayBuffer()) : await res.json();
  return {status:res.status,payload,headers:res.headers};
};
const list = uid => call('', {uid});
const send = (uid, body) => call('', {uid, method:'POST', body});
const read = (uid, version) => call('read',{uid,method:'POST',
  body:{procedureId:popId, version}});
const upload = (uid, requestId, bytes, mimeType='application/pdf') =>
  call('upload',{uid,method:'POST',body:{
    procedureId:popId,requestId,name:'manual.pdf',mimeType,
    dataBase64:bytes.toString('base64')
  }});
const file = (uid, version, binary=false) => call('file',{uid,binary,
  query:{procedureId:popId,version:String(version)}});
try {
  await Promise.all([
    adminDb.doc('tenants/' + ownerId).set({canonicalStoreId:canonical}),
    adminDb.doc('stores/' + canonical).set({id:canonical,ownerId}),
    adminDb.doc(members(manager)).set(member(manager,'manager')),
    adminDb.doc(members(seller)).set(member(seller,'seller')),
    adminDb.doc(members(cashier)).set(member(cashier,'cashier')),
    adminDb.doc(members(suspended)).set(member(suspended,'seller','suspended')),
  ]);
  assert.equal((await list()).status,401);
  assert.equal((await list(outsider)).status,403);
  assert.equal((await list(suspended)).status,403);
  assert.equal((await call('',{badToken:token(manager,'foreign-test-project')})).status,401);
  assert.equal((await list(seller)).status,200);
  assert.deepEqual((await list(seller)).payload.procedures,[]);
  const v1={procedureId:popId,requestId:'pop_request_first_12345',expectedVersion:0,
    title:'Rotina de abertura',body:'1. Inspecione as instalações.',
    audienceRoles:['seller'],attachment:null,retainAttachment:false};
  assert.equal((await send(seller,v1)).status,403);
  assert.equal((await send(outsider,v1)).status,403);
  const created=await send(manager,v1);
  assert.equal(created.status,200,JSON.stringify(created.payload));
  assert.equal(created.payload.procedure.currentVersion,1);
  assert.equal((await send(manager,v1)).status,200);
  assert.equal((await send(manager,{...v1, body:'conteúdo alterado'})).status,409);
  assert.equal((await list(seller)).payload.procedures.length,1);
  assert.equal((await list(cashier)).payload.procedures.length,0);
  assert.equal((await list(ownerId)).payload.procedures.length,1);
  assert.equal((await read(cashier,1)).status,404);
  assert.equal((await read(suspended,1)).status,403);
  const receipt=await read(seller,1);
  assert.equal(receipt.status,200);
  assert.ok(Date.parse(receipt.payload.readAt));
  assert.equal((await read(seller,1)).payload.readAt,receipt.payload.readAt);
  const v1receipts=await call('receipts',{uid:manager,query:{procedureId:popId,version:'1'}});
  assert.equal(v1receipts.status,200);
  assert.equal(v1receipts.payload.receipts.length,1);
  assert.equal(v1receipts.payload.receipts[0].userId,seller);
  assert.equal((await call('receipts',{uid:seller,query:{procedureId:popId,version:'1'}})).status,403);
  const v1seller=(await list(seller)).payload.procedures[0];
  assert.equal(v1seller.readAt,receipt.payload.readAt);

  const bytes=Buffer.from('%PDF-1.4\n1 0 obj\n<</Type/Catalog>>\nendobj\n%%EOF');
  const badMagic=await upload(manager,'pop_upload_invalid_12345',Buffer.from('not a pdf'));
  assert.equal(badMagic.status,400);
  const v2Request='pop_request_second_12345';
  const uploaded=await upload(manager,v2Request,bytes);
  assert.equal(uploaded.status,200,JSON.stringify(uploaded.payload));
  const attachment=uploaded.payload.attachment;
  assert.equal(attachment.mimeType,'application/pdf');
  assert.equal(attachment.sizeBytes,bytes.length);
  assert.ok(attachment.path.startsWith('staff-pops/'+canonical+'/'+popId+'/'));
  const revision2={procedureId:popId,requestId:v2Request,expectedVersion:1,
    title:'Rotina de abertura atualizada',body:'1. Verifique extintores e alarmes.',
    audienceRoles:['seller'],attachment,retainAttachment:false};
  const v2=await send(manager,revision2);
  assert.equal(v2.status,200,JSON.stringify(v2.payload));
  assert.equal(v2.payload.procedure.currentVersion,2);
  // The original attachment is bound to v2Request; forging a new request
  // with that attachment must be rejected before the stale-version check.
  assert.equal((await send(manager,{...revision2, requestId:'stale_request_12345'})).status,400);
  assert.equal((await send(manager,{...revision2, requestId:'stale_request_12345', attachment:null})).status,409);
  const sellerV2=(await list(seller)).payload.procedures[0];
  assert.equal(sellerV2.readAt,'');
  assert.equal(sellerV2.currentVersion,2);
  assert.equal((await read(seller,1)).status,404);
  assert.equal((await file(cashier,2)).status,404);
  assert.equal((await file(suspended,2)).status,403);
  assert.equal((await file(outsider,2)).status,403);
  assert.equal((await file(undefined,2)).status,401);
  assert.equal((await file(seller,1)).status,404);
  const actual=await file(seller,2,true);
  assert.equal(actual.status,200);
  assert.ok(actual.payload.equals(bytes));
  assert.equal(actual.headers.get('cache-control'),'private, no-store, max-age=0');
  assert.match(actual.headers.get('content-disposition') ?? '',/attachment;/);
  assert.equal((await read(seller,2)).status,200);
  const v2Receipts=await call('receipts',{uid:ownerId,query:{procedureId:popId,version:'2'}});
  assert.equal(v2Receipts.status,200);
  assert.equal(v2Receipts.payload.receipts.length,1);

  const v3=await send(ownerId,{procedureId:popId,requestId:'pop_request_third_12345',
    expectedVersion:2,title:'Rotina de abertura v3',body:'Texto revisado pela direção.',
    audienceRoles:[],attachment:null,retainAttachment:true});
  assert.equal(v3.status,200,JSON.stringify(v3.payload));
  assert.equal(v3.payload.procedure.currentVersion,3);
  assert.equal((await list(cashier)).payload.procedures.length,1);
  assert.equal((await list(seller)).payload.procedures[0].readAt,'');
  assert.equal((await file(seller,3,true)).status,200);
  assert.equal((await file(manager,2,true)).status,200);
  assert.equal((await file(cashier,2)).status,404);
  const history=await call('history',{uid:manager,query:{procedureId:popId}});
  assert.equal(history.status,200);
  assert.deepEqual(history.payload.versions.map(x=>x.version),[3,2,1]);
  assert.equal((await call('history',{uid:seller,query:{procedureId:popId}})).status,403);
  assert.equal((await adminDb.collection('stores/'+canonical+'/staffProcedures').get()).size,1);
  assert.equal((await adminDb.collection('stores/'+canonical+'/staffProcedures/'+popId+'/versions').get()).size,3);
  assert.equal((await adminDb.collection('users/'+seller+'/notifications').get()).size,3);
  assert.equal((await adminDb.collection('users/'+cashier+'/notifications').get()).size,1);
  assert.equal((await adminDb.collection('users/'+suspended+'/notifications').get()).size,0);
  assert.equal((await adminDb.collection('stores/'+canonical+'/timeClockEntries').get()).size,0);
  assert.equal((await adminDb.collection('stores/'+canonical+'/payments').get()).size,0);
  const bucket=adminStorage.bucket(projectId+'.firebasestorage.app');
  const [objectExists]=await bucket.file(attachment.path).exists();
  assert.equal(objectExists,true);
  console.log('STAFF_POPS_HTTP_STORAGE_E2E_PASS');
} finally {
  globalThis.fetch=fetchOriginal;
  await new Promise(resolve=>server.close(resolve));
}
