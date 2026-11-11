import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import { generateKeyPairSync, sign } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { initializeTestEnvironment, assertFails, type RulesTestEnvironment } from '@firebase/rules-unit-testing';
import { doc, setDoc, getDoc } from 'firebase/firestore';
import express from 'express';
import type { Server } from 'node:http';
import { adminDb } from '../server/firebaseAdmin.js';
import handler from '../server/gamification/globalChallengeAdminHandler.js';
import serverlessHandler from '../api/admin/operations/health.js';
import { createGlobalChallengeDraft } from '../server/gamification/globalChallengeAdminRepository.js';

if (!/^(127\.0\.0\.1|localhost):\d+$/.test(process.env.FIRESTORE_EMULATOR_HOST ?? '')) {
  throw new Error('LOCAL_FIRESTORE_EMULATOR_REQUIRED');
}
const projectId = 'demo-global-challenges';
process.env.FIREBASE_PROJECT_ID = projectId;
// Never allow an inherited credential or Vercel environment to select a real project.
delete process.env.FIREBASE_SERVICE_ACCOUNT_JSON;
delete process.env.GOOGLE_APPLICATION_CREDENTIALS;
delete process.env.VERCEL;
const { privateKey, publicKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
const nativeFetch = globalThis.fetch;
const certificateUrl = 'https://www.googleapis.com/robot/v1/metadata/x509/securetoken@system.gserviceaccount.com';
const token = (uid = 'admin', extra: Record<string, unknown> = {}) => {
  const now = Math.floor(Date.now() / 1000);
  const header = Buffer.from(JSON.stringify({ alg: 'RS256', kid: 'test-key' })).toString('base64url');
  const payload = Buffer.from(JSON.stringify({ aud: projectId, iss: `https://securetoken.google.com/${projectId}`,
    sub: uid, exp: now + 3600, iat: now, auth_time: now, email_verified: true, ...extra })).toString('base64url');
  const data = `${header}.${payload}`;
  return `${data}.${sign('RSA-SHA256', Buffer.from(data), privateKey).toString('base64url')}`;
};
const draft = (id: string) => ({ id, title: 'Create a community', description: 'Verified community creation',
  status: 'draft' as const, validationMode: 'deterministic' as const, rewardKCoins: 0, rewardXp: 10,
  maxCompletionsPerUser: 1, sponsorType: 'kyrub' as const });
let environment: RulesTestEnvironment;
let server: Server;
let base: string;
before(async () => {
  environment = await initializeTestEnvironment({ projectId,
    firestore: { rules: await readFile('.firebase/firestore.combined.rules', 'utf8') } });
  await environment.clearFirestore();
  await adminDb.doc('kyrub_admin/control_plane/admins/admin').set({ uid: 'admin', role: 'super_admin', status: 'active' });
  await adminDb.doc('kyrub_admin/control_plane/admins/inactive').set({ uid: 'inactive', role: 'super_admin', status: 'disabled' });
  await adminDb.doc('kyrub_admin/control_plane/admins/mismatch').set({ uid: 'admin', role: 'super_admin', status: 'active' });
  await adminDb.doc('kyrub_admin/control_plane/admins/operations').set({ uid: 'operations', role: 'operations', status: 'active' });
  globalThis.fetch = (async (url: Parameters<typeof fetch>[0], init?: Parameters<typeof fetch>[1]) => {
    if (String(url) === certificateUrl) return new Response(JSON.stringify({ 'test-key': publicKey.export({ type: 'spki', format: 'pem' }) }),
      { headers: { 'cache-control': 'max-age=3600' } });
    if (!String(url).startsWith('http://127.0.0.1:')) throw new Error('UNEXPECTED_NETWORK_REQUEST');
    return nativeFetch(url, init);
  }) as typeof fetch;
  // Let malformed JSON values reach the shared handler for runtime-validation coverage.
  const app = express(); app.use(express.json({ strict: false }));
  app.all('/api/admin/global-challenges', (req, res) => { void handler(req, res); });
  server = await new Promise<Server>(resolve => { const listener = app.listen(0, '127.0.0.1', () => resolve(listener)); });
  const address = server.address(); assert.ok(address && typeof address !== 'string');
  base = `http://127.0.0.1:${address.port}/api/admin/global-challenges`;
});
after(async () => {
  globalThis.fetch = nativeFetch;
  if (server) await new Promise<void>((resolve, reject) => server.close(e => e ? reject(e) : resolve()));
  await environment?.cleanup();
  await adminDb.terminate();
});
const request = async (body: unknown, operation = 'create', bearer: string | null = token(), method = 'POST') => {
  const result = await fetch(`${base}?operation=${operation}`, { method,
    headers: { 'content-type': 'application/json', ...(bearer ? { authorization: `Bearer ${bearer}` } : {}) },
    ...(method === 'POST' ? { body: JSON.stringify(body) } : {}) });
  assert.equal(result.headers.get('cache-control'), 'no-store');
  return { status: result.status, body: await result.json() };
};
const auditCount = async (id: string) => (await adminDb.collection(`global_challenges/${id}/audit`).get()).size;

test('HTTP authentication and role authority reject every unauthorized write', async t => {
  const cases: Array<[string, string | null, number]> = [
    ['missing', null, 401], ['invalid', 'invalid', 401],
    ['null-header', 'bnVsbA.e30.fake', 401], ['null-payload', 'e30.bnVsbA.fake', 401],
    ['expired', token('admin', { exp: Math.floor(Date.now() / 1000) - 3600 }), 401],
    ['expired-within-skew', token('admin', { exp: Math.floor(Date.now() / 1000) - 1 }), 401],
    ['common-user', token('user'), 403], ['self-assigned-claim', token('user', { role: 'super_admin', admin: true }), 403],
    ['inactive', token('inactive'), 403], ['uid-mismatch', token('mismatch'), 403],
    ['operations-role', token('operations'), 403], ['unverified-email', token('admin', { email_verified: false }), 403],
    ['bad-signature', token().split('.').slice(0, 2).join('.') + '.' + Buffer.alloc(256).toString('base64url'), 401],
    ['wrong-project', token('admin', { aud: 'other-project' }), 401],
  ];
  for (const [id, bearer, status] of cases) await t.test(id, async () => {
    for (const operation of ['create', 'publish']) {
      const result = await request(operation === 'create' ? draft(id) : { challengeId: id }, operation, bearer);
      assert.equal(result.status, status, JSON.stringify(result));
    }
    assert.equal((await adminDb.doc(`global_challenges/${id}`).get()).exists, false);
    assert.equal(await auditCount(id), 0);
  });
});

test('runtime validation rejects malformed contracts, injected audit and invalid business rules', async () => {
  const bad = [null, [], { title: 5 }, { description: null }, { validationMode: 'anything' },
    { rewardXp: -1 }, { rewardKCoins: 0.5 }, { maxCompletionsPerUser: 0 }, { maxCompletions: '1' },
    { sponsorType: 'store', sponsorId: 'store' }, { sponsorId: 'fake' }, { status: 'published' },
    { id: '../bad' }, { title: ' '.repeat(3) }, { description: 'x'.repeat(5001) },
    { startsAt: 'invalid' }, { endsAt: null }, { startsAt: '2026-12-02T00:00:00Z', endsAt: '2026-12-01T00:00:00Z' },
    { createdBy: 'other' }, { occurredAt: '2000-01-01T00:00:00Z' }, { role: 'super_admin' }];
  for (const input of bad) {
    const body = input === null || Array.isArray(input) ? input : { ...draft('bad-input'), ...input };
    assert.equal((await request(body)).status, 400, JSON.stringify(body));
  }
  assert.equal((await request({})).status, 400);
  assert.equal((await request({ challengeId: 'x', actorId: 'other' }, 'publish')).status, 400);
  assert.equal((await request({}, 'unknown')).status, 400);
  assert.equal((await request({}, 'create', token(), 'GET')).status, 405);
  assert.equal((await adminDb.doc('global_challenges/bad-input').get()).exists, false);
});

test('authorized create and publish persist server provenance and exactly two audit events', async () => {
  const created = await request(draft('happy'));
  assert.equal(created.status, 201);
  const stored = (await adminDb.doc('global_challenges/happy').get()).data()!;
  assert.equal(stored.createdBy, 'admin'); assert.equal(stored.status, 'draft');
  assert.ok(Math.abs(Date.parse(stored.createdAt) - Date.now()) < 10000);
  assert.equal((await request(draft('happy'))).status, 409);
  assert.equal((await request({ challengeId: 'happy' }, 'publish')).status, 200);
  const published = (await adminDb.doc('global_challenges/happy').get()).data()!;
  assert.equal(published.publishedBy, 'admin'); assert.equal(published.status, 'published');
  assert.equal(published.createdAt, stored.createdAt);
  assert.equal((await request({ challengeId: 'happy' }, 'publish')).status, 409);
  assert.deepEqual((await adminDb.doc('global_challenges/happy/audit/created').get()).data(),
    { action: 'created', actorId: 'admin', challengeId: 'happy', occurredAt: stored.createdAt });
  assert.deepEqual((await adminDb.doc('global_challenges/happy/audit/published').get()).data(),
    { action: 'published', actorId: 'admin', challengeId: 'happy', occurredAt: published.publishedAt });
  assert.equal(await auditCount('happy'), 2);
  assert.equal((await request({ challengeId: 'missing' }, 'publish')).status, 404);
});

test('concurrent creates and publications commit only once each', async () => {
  const creates = await Promise.all(Array.from({ length: 8 }, () => request(draft('race'))));
  assert.deepEqual(creates.map(x => x.status).sort(), [201, 409, 409, 409, 409, 409, 409, 409]);
  const publications = await Promise.all(Array.from({ length: 8 }, () => request({ challengeId: 'race' }, 'publish')));
  assert.deepEqual(publications.map(x => x.status).sort(), [200, 409, 409, 409, 409, 409, 409, 409]);
  assert.equal(await auditCount('race'), 2);
});

test('audit failure rolls back create and publish without partial business writes', async () => {
  await adminDb.doc('global_challenges/create-rollback/audit/created').set({ sentinel: true });
  assert.equal((await request(draft('create-rollback'))).status, 503);
  assert.equal((await adminDb.doc('global_challenges/create-rollback').get()).exists, false);
  assert.equal((await request(draft('publish-rollback'))).status, 201);
  await adminDb.doc('global_challenges/publish-rollback/audit/published').set({ sentinel: true });
  assert.equal((await request({ challengeId: 'publish-rollback' }, 'publish')).status, 503);
  const stored = (await adminDb.doc('global_challenges/publish-rollback').get()).data()!;
  assert.equal(stored.status, 'draft'); assert.equal(stored.publishedAt, undefined);
  assert.deepEqual((await adminDb.doc('global_challenges/publish-rollback/audit/published').get()).data(), { sentinel: true });
});

test('transaction independently rechecks current role; expired or corrupt drafts cannot publish', async () => {
  await assert.rejects(createGlobalChallengeDraft(draft('direct-denied'), 'user', new Date().toISOString()), /FORBIDDEN/);
  assert.equal((await adminDb.doc('global_challenges/direct-denied').get()).exists, false);
  assert.equal((await request({ ...draft('ended'), endsAt: '2020-01-01T00:00:00Z' })).status, 201);
  assert.equal((await request({ challengeId: 'ended' }, 'publish')).status, 400);
  await adminDb.doc('global_challenges/corrupt').set({ ...draft('other-id') });
  assert.equal((await request({ challengeId: 'corrupt' }, 'publish')).status, 409);
  assert.equal(await auditCount('corrupt'), 0);
});

test('serverless multiplexer uses the same handler and contract', async () => {
  let status = 200; let body: any;
  const response = { setHeader() {}, status(value: number) { status = value; return this; }, json(value: unknown) { body = value; } };
  await serverlessHandler({ method: 'POST', headers: { authorization: `Bearer ${token()}` },
    query: { transport: 'global-challenges' }, body: draft('serverless') }, response);
  assert.equal(status, 201); assert.equal(body.challenge.status, 'draft');
  await serverlessHandler({ method: 'POST', headers: { authorization: `Bearer ${token()}` },
    query: { transport: 'global-challenges', operation: 'publish' }, body: { challengeId: 'serverless' } }, response);
  assert.equal(status, 200); assert.equal(body.challenge.status, 'published');
});

test('browser rules forbid direct challenge/audit writes and self-assigned admin profiles', async () => {
  for (const uid of ['user', 'admin']) {
    const db = environment.authenticatedContext(uid, { role: 'super_admin', admin: true }).firestore();
    await assertFails(setDoc(doc(db, 'global_challenges/browser'), draft('browser')));
    await assertFails(setDoc(doc(db, 'global_challenges/happy/audit/forged'), { actorId: uid }));
    await assertFails(setDoc(doc(db, `kyrub_admin/control_plane/admins/${uid}`), { uid, role: 'super_admin', status: 'active' }));
    await assertFails(getDoc(doc(db, 'global_challenges/happy')));
  }
});
