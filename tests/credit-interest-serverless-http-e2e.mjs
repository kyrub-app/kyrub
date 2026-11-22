import assert from 'node:assert/strict';
import {createSign, generateKeyPairSync} from 'node:crypto';
import {once} from 'node:events';
import express from 'express';
import handler from '../api/health.ts';
import {adminDb} from '../server/firebaseAdmin.ts';
import {getPrimaryUserStoreDocumentPath} from '../src/utils/storePaths.ts';

const projectId = 'kyrub-security-test';
assert.equal(process.env.FIRESTORE_EMULATOR_HOST, '127.0.0.1:8088');
assert.equal(process.env.FIREBASE_AUTH_EMULATOR_HOST, '127.0.0.1:9099');
assert.equal(process.env.FIREBASE_PROJECT_ID, projectId);
assert.equal(process.env.GCLOUD_PROJECT, projectId);
assert.equal(process.env.GOOGLE_CLOUD_PROJECT, projectId);
assert.notEqual(process.env.VERCEL_ENV, 'production');
assert.notEqual(process.env.KYRUB_OFFICIAL_PLAN_PIX_CHECKOUT_ENABLED, 'true');

const ownerId = 'credit_http_owner';
const buyerId = 'credit_http_buyer';
const outsiderId = 'credit_http_outsider';
const orderId = 'credit_http_order';
const canonicalId = 'credit_http_canonical';
const paymentId = 'credit_http_payment';
const {privateKey,publicKey} = generateKeyPairSync('rsa', {
  modulusLength:2048,
  privateKeyEncoding:{type:'pkcs8',format:'pem'},
  publicKeyEncoding:{type:'spki',format:'pem'},
});
const kid = 'isolated-local-cert';
const certUrl = 'https://www.googleapis.com/robot/v1/metadata/x509/securetoken@system.gserviceaccount.com';
const originalFetch = globalThis.fetch;
let certificateReads = 0;
globalThis.fetch = (resource,options) => {
  const url = resource instanceof URL ? resource.href : typeof resource === 'string' ? resource : resource.url;
  if(url === certUrl) {
    certificateReads++;
    return Promise.resolve(new Response(JSON.stringify({[kid]:publicKey}),{
      status:200,headers:{'content-type':'application/json','cache-control':'max-age=60'},
    }));
  }
  if(url.startsWith('https://'))throw Error('NO_EXTERNAL_HTTP_IN_CREDIT_E2E:' + new URL(url).hostname);
  return originalFetch(resource,options);
};
const now = Math.floor(Date.now()/1000);
const signed = (uid, options = {}) => {
  const header = Buffer.from(JSON.stringify({alg:'RS256',kid,typ:'JWT'})).toString('base64url');
  const payload = Buffer.from(JSON.stringify({
    aud: options.aud ?? projectId,
    iss: 'https://securetoken.google.com/' + (options.aud ?? projectId),
    sub: uid, iat:now, exp:now+1800, auth_time:now,
    email:uid + '@example.invalid',
  })).toString('base64url');
  const data = header + '.' + payload;
  const signature = createSign('RSA-SHA256').update(data).sign(privateKey,'base64url');
  return data + '.' + signature;
};
const tokens = Object.fromEntries([ownerId,buyerId,outsiderId].map(uid=>[uid,signed(uid)]));
const app = express();
app.use(express.json({limit:'32kb'}));
app.all('/api/health', async (req,res) => {await handler(req,res);});
const server = app.listen(0,'127.0.0.1');
await once(server,'listening');
const origin = 'http://127.0.0.1:' + server.address().port;
const creditPath = '/api/health?transport=store-promotions&surface=credit-interest';
const notificationsPath = '/api/health?transport=user-notifications';
async function call(path, {uid,token,method='GET',body}={}) {
  const authorization= token ?? (uid ? tokens[uid] : '');
  const response=await originalFetch(origin+path,{
    method,
    headers:{...(authorization?{authorization:'Bearer '+authorization}:{}),
      ...(body?{'content-type':'application/json'}:{})},
    ...(body?{body:JSON.stringify(body)}:{}),
  });
  return {status:response.status,payload:response.status===204?null:await response.json()};
}
try {
  const paymentPath='stores/'+ownerId+'/payments/'+paymentId;
  const orderPath='artifacts/'+ownerId+'/public/data/customerOrders/'+orderId;
  await Promise.all([
    adminDb.doc(getPrimaryUserStoreDocumentPath(ownerId)).set({
      id:ownerId,ownerId,name:'Loja HTTP isolada',status:'open',
    }),
    adminDb.doc('tenants/'+ownerId).set({canonicalStoreId:canonicalId}),
    adminDb.doc('stores/'+canonicalId).set({id:canonicalId,ownerId,slug:'credit-http-isolated'}),
    adminDb.doc(orderPath).set({
      id:orderId,storeId:ownerId,buyerId,createdByUserId:buyerId,
      status:'rejected',paymentStatus:'paid',refundStatus:'required',
      total:0,buyerName:'Comprador fictício',
    }),
    adminDb.doc(paymentPath).set({
      id:paymentId,storeId:ownerId,orderId,buyerId,
      paymentIntentId:'credit_http_intent',
      amount:23.30,currency:'BRL',method:'pix',context:'marketplace',
      status:'paid',provider:'mercado-pago',providerPaymentId:'mp_isolated_http',
      idempotencyKey:'credit_http_payment_key',
      createdAt:'2026-11-22T17:00:00.000Z',
      updatedAt:'2026-11-22T17:01:00.000Z',
      paidAt:'2026-11-22T17:01:00.000Z',refundedAt:'',
    }),
  ]);
  assert.equal((await call(creditPath+'&path=status&storeId='+ownerId+'&orderId='+orderId)).status,401);
  assert.equal((await call(notificationsPath+'&path=read', {method:'POST',body:{notificationId:'bogus'}})).status,401);
  assert.equal((await call(creditPath+'&path=status&storeId='+ownerId+'&orderId='+orderId,{token:signed(ownerId,{aud:'different-project'})})).status,401);
  const tampered = tokens[ownerId].slice(0,-2)+'xx';
  assert.equal((await call(creditPath+'&path=status&storeId='+ownerId+'&orderId='+orderId,{token:tampered})).status,401);
  assert.equal((await call(notificationsPath+'&limit=3',{token:tampered})).status,401);

  const offerBody={storeId:ownerId,orderId,bonusPercent:20};
  assert.equal((await call(creditPath+'&path=offer',{uid:buyerId,method:'POST',body:offerBody})).status,403);
  const first=await call(creditPath+'&path=offer',{uid:ownerId,method:'POST',body:offerBody});
  assert.equal(first.status,200,JSON.stringify(first));
  assert.equal(first.payload.proposal.amountMinor,2330);
  assert.equal(first.payload.proposal.bonusMinor,466);
  assert.equal(first.payload.proposal.proposedCreditMinor,2796);
  assert.equal(first.payload.proposal.status,'awaiting_response');
  assert.equal(first.payload.proposal.creditIssued,false);
  const repeat=await call(creditPath+'&path=offer',{uid:ownerId,method:'POST',body:offerBody});
  assert.equal(repeat.status,200);
  assert.deepEqual(repeat.payload,first.payload);
  assert.equal((await call(creditPath+'&path=offer',{uid:ownerId,method:'POST',
    body:{...offerBody,bonusPercent:30}})).status,409);
  assert.equal((await call(creditPath+'&path=status&storeId='+ownerId+'&orderId='+orderId,{uid:ownerId})).status,200);
  assert.equal((await call(creditPath+'&path=status&storeId='+ownerId+'&orderId='+orderId,{uid:buyerId})).status,403);

  const buyerMine=await call(creditPath+'&path=mine&storeId='+canonicalId,{uid:buyerId});
  assert.equal(buyerMine.status,200,JSON.stringify(buyerMine));
  assert.equal(buyerMine.payload.proposals.length,1);
  const outsiderMine=await call(creditPath+'&path=mine&storeId='+canonicalId,{uid:outsiderId});
  assert.equal(outsiderMine.status,200);
  assert.deepEqual(outsiderMine.payload.proposals,[]);
  assert.equal((await call(creditPath+'&path=respond',{uid:outsiderId,method:'POST',body:{
    storeId:ownerId,orderId,choice:'interested',
  }})).status,404);

  const inbox=await call(notificationsPath+'&limit=60',{uid:buyerId});
  assert.equal(inbox.status,200,JSON.stringify(inbox));
  assert.equal(inbox.payload.unreadCount,1);
  assert.equal(inbox.payload.notifications.length,1);
  const notification=inbox.payload.notifications[0];
  assert.equal(notification.eventType,'credit_interest_proposed');
  assert.equal(notification.target.storeSlug,'credit-http-isolated');
  assert.equal((await call(notificationsPath+'&limit=60',{uid:outsiderId})).payload.notifications.length,0);
  const readPath=notificationsPath+'&path=read';
  assert.equal((await call(readPath,{uid:outsiderId,method:'POST',body:{notificationId:notification.id}})).status,404);
  assert.equal((await call(readPath,{uid:buyerId,method:'POST',body:{notificationId:notification.id}})).status,204);

  const interest=await call(creditPath+'&path=respond',{uid:buyerId,method:'POST',
    body:{storeId:ownerId,orderId,choice:'interested'}});
  assert.equal(interest.status,200,JSON.stringify(interest));
  assert.equal(interest.payload.proposal.status,'interested');
  const refund=await call(creditPath+'&path=respond',{uid:buyerId,method:'POST',
    body:{storeId:ownerId,orderId,choice:'prefers_refund'}});
  assert.equal(refund.status,200,JSON.stringify(refund));
  assert.equal(refund.payload.proposal.status,'prefers_refund');
  assert.deepEqual((await call(creditPath+'&path=respond',{uid:buyerId,method:'POST',
    body:{storeId:ownerId,orderId,choice:'prefers_refund'}})).payload,refund.payload);
  assert.equal((await call(notificationsPath+'&limit=60',{uid:buyerId})).payload.unreadCount,0);

  assert.equal((await adminDb.doc(paymentPath).get()).get('status'),'paid');
  assert.equal((await adminDb.doc(orderPath).get()).get('refundStatus'),'required');
  assert.equal((await adminDb.collection('stores/'+ownerId+'/orderCreditBalances').get()).size,0);
  assert.equal((await adminDb.collection('stores/'+ownerId+'/promotions').get()).size,0);
  assert.equal((await adminDb.collection('stores/'+ownerId+'/paymentRefunds').get()).size,0);
  assert.equal((await adminDb.collection('users/'+buyerId+'/notifications').get()).size,1);
  assert.ok(certificateReads>0,'RS256 verifier must request the isolated test certificate');
  console.log('CREDIT HTTP: REAL api/health → serverless transports → Express routers → RS256 verification → emulated Firestore PASS');
} finally {
  globalThis.fetch=originalFetch;
  await new Promise(resolve=>server.close(resolve));
}
