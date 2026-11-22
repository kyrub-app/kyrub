import assert from 'node:assert/strict';
import { createSign, generateKeyPairSync } from 'node:crypto';
import { once } from 'node:events';
import express from 'express';
import handler from '../api/health.ts';
import { adminDb } from '../server/firebaseAdmin.ts';

const projectId = 'kyrub-security-test';
if (!/^(127\.0\.0\.1|localhost):\d+$/.test(process.env.FIRESTORE_EMULATOR_HOST ?? '')) {
  throw Error('LOCAL_FIRESTORE_EMULATOR_REQUIRED');
}
assert.equal(process.env.FIREBASE_PROJECT_ID, projectId);
assert.notEqual(process.env.VERCEL_ENV, 'production');

const ownerId = 'notices_owner_emulated';
const canonicalId = 'notices_canonical_emulated';
const managerId = 'notices_manager_emulated';
const cashierId = 'notices_cashier_emulated';
const sellerId = 'notices_seller_emulated';
const suspendedId = 'notices_suspended_emulated';
const outsiderId = 'notices_outsider_emulated';
const { privateKey, publicKey } = generateKeyPairSync('rsa', {
  modulusLength: 2048,
  privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
  publicKeyEncoding: { type: 'spki', format: 'pem' },
});
const kid = 'staff-isolated-only';
const certificateUrl = 'https://www.googleapis.com/robot/v1/metadata/x509/securetoken@system.gserviceaccount.com';
const realFetch = globalThis.fetch;
globalThis.fetch = (resource, options) => {
  const url = resource instanceof URL ? resource.href : typeof resource === 'string' ? resource : resource.url;
  if (url === certificateUrl) {
    return Promise.resolve(new Response(JSON.stringify({ [kid]: publicKey }), {
      status: 200,
      headers: { 'content-type': 'application/json', 'cache-control': 'max-age=60' },
    }));
  }
  if (url.startsWith('https://')) throw Error('EXTERNAL_HTTP_BLOCKED:' + new URL(url).hostname);
  return realFetch(resource, options);
};
const now = Math.floor(Date.now() / 1000);
const signed = (uid, project = projectId) => {
  const header = Buffer.from(JSON.stringify({ alg: 'RS256', kid, typ: 'JWT' })).toString('base64url');
  const payload = Buffer.from(JSON.stringify({
    aud: project, iss: 'https://securetoken.google.com/' + project,
    sub: uid, iat: now, exp: now + 1800, auth_time: now,
  })).toString('base64url');
  const raw = header + '.' + payload;
  return raw + '.' + createSign('RSA-SHA256').update(raw).sign(privateKey, 'base64url');
};
const tokens = Object.fromEntries(
  [ownerId, managerId, cashierId, sellerId, suspendedId, outsiderId].map(uid => [uid, signed(uid)])
);
const app = express();
app.use(express.json({ limit: '32kb' }));
app.all('/api/health', async (req, res) => { await handler(req, res); });
const server = app.listen(0, '127.0.0.1');
await once(server, 'listening');
const origin = 'http://127.0.0.1:' + server.address().port;
const apiPath = '/api/health?transport=staff-notices';
const member = (userId, role, status = 'active') => ({
  storeId: canonicalId, userId, role, status,
  invitedBy: ownerId, acceptedAt: new Date().toISOString(),
});
async function call(path, { uid, token, method = 'GET', body } = {}) {
  const authorization = token ?? (uid ? tokens[uid] : '');
  const response = await realFetch(origin + path, {
    method, headers: {
      ...(authorization ? { authorization: 'Bearer ' + authorization } : {}),
      ...(body ? { 'content-type': 'application/json' } : {}),
    }, ...(body ? { body: JSON.stringify(body) } : {}),
  });
  return { status: response.status, payload: await response.json() };
}
const publish = (uid, body) => call(apiPath, { uid, method: 'POST', body: { storeId: ownerId, ...body } });
const read = (uid, noticeId) => call(apiPath + '&path=read', {
  uid, method: 'POST', body: { storeId: ownerId, noticeId },
});
const mine = uid => call(apiPath + '&storeId=' + ownerId, { uid });
try {
  await Promise.all([
    adminDb.doc('tenants/' + ownerId).set({ canonicalStoreId: canonicalId }),
    adminDb.doc('stores/' + canonicalId).set({ id: canonicalId, ownerId }),
    adminDb.doc('stores/' + canonicalId + '/members/' + managerId).set(member(managerId, 'manager')),
    adminDb.doc('stores/' + canonicalId + '/members/' + cashierId).set(member(cashierId, 'cashier')),
    adminDb.doc('stores/' + canonicalId + '/members/' + sellerId).set(member(sellerId, 'seller')),
    adminDb.doc('stores/' + canonicalId + '/members/' + suspendedId).set(member(suspendedId, 'cashier', 'suspended')),
  ]);
  assert.equal((await mine()).status, 401);
  assert.equal((await mine(outsiderId)).status, 403);
  assert.equal((await mine(suspendedId)).status, 403);
  assert.equal((await mine(cashierId)).status, 200);
  assert.equal((await mine(cashierId)).payload.notices.length, 0);
  assert.equal((await mine(ownerId).then(x => x.status)), 200);
  assert.equal((await mine(ownerId).then(x => x.status)), 200);
  assert.equal((await call(apiPath + '&storeId=' + ownerId, { token: signed(managerId, 'wrong-project') })).status, 401);

  const request = {
    requestId: 'staff_test_notice_123456',
    title: 'Conferência de abertura',
    body: 'Confira os equipamentos antes do atendimento.',
    audienceRoles: ['cashier'],
  };
  assert.equal((await publish(sellerId, request)).status, 403);
  assert.equal((await publish(outsiderId, request)).status, 403);
  const first = await publish(managerId, request);
  assert.equal(first.status, 200, JSON.stringify(first));
  assert.equal(first.payload.notice.title, request.title);
  assert.equal(first.payload.notice.canonicalStoreId, canonicalId);
  assert.equal(first.payload.notice.publishedBy, managerId);
  assert.deepEqual(first.payload.notice.audienceRoles, ['cashier']);

  const second = await publish(managerId, request);
  assert.equal(second.status, 200, JSON.stringify(second));
  assert.deepEqual(second.payload, first.payload);
  assert.equal((await publish(managerId, { ...request, body: 'Mensagem modificada.' })).status, 409);
  assert.equal((await mine(cashierId)).payload.notices.length, 1);
  assert.equal((await mine(sellerId)).payload.notices.length, 0);
  assert.equal((await mine(ownerId)).payload.notices.length, 1);
  assert.equal((await mine(managerId)).payload.notices.length, 1);
  assert.equal((await read(sellerId, request.requestId)).status, 404);
  assert.equal((await read(suspendedId, request.requestId)).status, 403);

  const receipt = await read(cashierId, request.requestId);
  assert.equal(receipt.status, 200);
  assert.ok(Number.isFinite(Date.parse(receipt.payload.readAt)));
  const again = await read(cashierId, request.requestId);
  assert.equal(again.status, 200);
  assert.equal(again.payload.readAt, receipt.payload.readAt);
  const visible = await mine(cashierId);
  assert.equal(visible.payload.notices[0].readAt, receipt.payload.readAt);

  assert.equal((await adminDb.collection('users/' + cashierId + '/notifications').get()).size, 1);
  assert.equal((await adminDb.collection('users/' + sellerId + '/notifications').get()).size, 0);
  assert.equal((await adminDb.collection('users/' + suspendedId + '/notifications').get()).size, 0);
  const noticeRef = adminDb.doc('stores/' + canonicalId + '/staffNotices/' + request.requestId);
  assert.equal((await noticeRef.collection('readReceipts').get()).size, 1);
  assert.equal((await adminDb.collection('stores/' + canonicalId + '/staffNotices').get()).size, 1);

  const all = await publish(ownerId, {
    requestId: 'staff_test_notice_all_1234',
    title: 'Reunião de equipe',
    body: 'Reunião geral amanhã pela manhã.',
    audienceRoles: [],
  });
  assert.equal(all.status, 200);
  assert.equal((await mine(sellerId)).payload.notices.length, 1);
  assert.equal((await mine(cashierId)).payload.notices.length, 2);
  assert.equal((await adminDb.collection('users/' + sellerId + '/notifications').get()).size, 1);
  assert.equal((await adminDb.collection('users/' + suspendedId + '/notifications').get()).size, 0);
  assert.equal((await adminDb.collection('stores/' + canonicalId + '/timeClockEntries').get()).size, 0);
  assert.equal((await adminDb.collection('stores/' + canonicalId + '/payments').get()).size, 0);
  console.log('STAFF_NOTICES_HTTP_E2E_PASS');
} finally {
  globalThis.fetch = realFetch;
  await new Promise(resolve => server.close(resolve));
}
