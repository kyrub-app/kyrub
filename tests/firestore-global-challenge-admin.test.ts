import { getTransformedRoutes } from '@vercel/routing-utils';
import { minimatch } from 'minimatch';
import { parse as parseUrl } from 'node:url';
import assert from 'node:assert/strict';
import { after, before, beforeEach, test } from 'node:test';
import { createHash, generateKeyPairSync, sign } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { initializeTestEnvironment, assertFails, type RulesTestEnvironment } from '@firebase/rules-unit-testing';
import { doc, setDoc, getDoc } from 'firebase/firestore';
import express from 'express';
import { MemoryStore } from 'express-rate-limit';
import { getAuth } from 'firebase-admin/auth';
import type { Server } from 'node:http';
import { getFirestore, type Transaction } from 'firebase-admin/firestore';
import { GLOBAL_CHALLENGE_ACTOR_LIMIT, GLOBAL_CHALLENGE_INGRESS_LIMIT } from '../server/gamification/globalChallengeAdminRateLimit.js';
import { adminDb, adminAuth } from '../server/firebaseAdmin.js';
import handler, { createGlobalChallengeAdminRouter, GLOBAL_CHALLENGE_PAYLOAD_BYTES } from '../server/gamification/globalChallengeAdminHandler.js';
import serverlessHandler from '../api/admin/operations/health.js';
import { createGlobalChallengeDraft } from '../server/gamification/globalChallengeAdminRepository.js';

if (!/^(127\.0\.0\.1|localhost):\d+$/.test(process.env.FIRESTORE_EMULATOR_HOST ?? '')) {
  throw new Error('LOCAL_FIRESTORE_EMULATOR_REQUIRED');
}
if (!/^(127\.0\.0\.1|localhost):\d+$/.test(process.env.FIREBASE_AUTH_EMULATOR_HOST ?? '')) throw new Error('LOCAL_AUTH_EMULATOR_REQUIRED');
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
  const app = express();
  app.use('/api/admin/global-challenges', createGlobalChallengeAdminRouter());
  const config = JSON.parse(await readFile('vercel.json', 'utf8'));
  assert.equal(config.rewrites[0].source, '/api/admin/global-challenges');
  const compiled = getTransformedRoutes({ rewrites: [config.rewrites[0]] });
  assert.equal(compiled.error, null);
  // Local adapter for the official compiler's output. Query merging follows
  // Vercel CLI 48.10.0 src/util/dev/router.ts (destination + incoming query).
  // This tests configuration/handler integration; it is not a hosted edge test.
  app.use('/vercel-offline', express.json({ limit: GLOBAL_CHALLENGE_PAYLOAD_BYTES }));
  app.use('/vercel-offline', async (req, res) => {
    const incoming = parseUrl(req.url, true);
    const route = compiled.routes?.find(route => 'src' in route && new RegExp(route.src).test(incoming.pathname ?? '/'));
    assert.ok(route && 'dest' in route && typeof route.dest === 'string');
    const destination = parseUrl(route.dest, true);
    assert.equal(destination.pathname, '/api/admin/operations/health');
    const query = Object.assign(destination.query, incoming.query);
    await serverlessHandler({ method: req.method, headers: req.headers, query: query as Record<string, string | string[]>, body: req.body }, res);
  });
  server = await new Promise<Server>(resolve => { const listener = app.listen(0, '127.0.0.1', () => resolve(listener)); });
  const address = server.address(); assert.ok(address && typeof address !== 'string');
  base = `http://127.0.0.1:${address.port}/api/admin/global-challenges`;
});
const ensureAuthUser = async (uid: string) => {
  try { await adminAuth.getUser(uid); }
  catch (error) {
    if ((error as { code?: string }).code !== 'auth/user-not-found') throw error;
    try { await adminAuth.createUser({ uid, emailVerified: true }); }
    catch (creation) { if ((creation as { code?: string }).code !== 'auth/uid-already-exists') throw creation; }
  }
};
beforeEach(async () => {
  await ensureAuthUser('admin');
  const key = createHash('sha256').update('admin').digest('hex');
  await adminDb.doc(`kyrub_admin/control_plane/rate_limits/global-challenges-${key}`).delete();
  await adminDb.doc(`kyrub_admin/control_plane/rate_limits/global-challenges-read-${key}`).delete();
});
after(async () => {
  globalThis.fetch = nativeFetch;
  if (server) await new Promise<void>((resolve, reject) => server.close(e => e ? reject(e) : resolve()));
  await environment?.cleanup();
  await adminDb.terminate();
});
const request = async (body: unknown, operation = 'create', bearer: string | null = token(), method = 'POST') => {
  if (bearer) {
    try {
      const uid = JSON.parse(Buffer.from(bearer.split('.')[1], 'base64url').toString()).sub;
      if (typeof uid === 'string' && /^[A-Za-z0-9_-]{1,128}$/.test(uid)) await ensureAuthUser(uid);
    } catch (error) { if (!(error instanceof SyntaxError) && !(error instanceof TypeError)) throw error; }
  }
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
    const read = await fetch(`${base}?operation=list`, { headers: bearer ? { authorization: `Bearer ${bearer}` } : {} });
    assert.equal(read.status, status);
    const get = await fetch(`${base}?operation=get&challengeId=happy`, { headers: bearer ? { authorization: `Bearer ${bearer}` } : {} });
    assert.equal(get.status, status);
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
  assert.equal((await request({}, 'create', token(), 'PUT')).status, 405);
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
  await serverlessHandler({ method: 'POST', headers: { authorization: `Bearer ${token()}`, 'content-type': 'application/json', 'content-length': String(Buffer.byteLength(JSON.stringify(draft('serverless')))) },
    query: { transport: 'global-challenges' }, body: draft('serverless') }, response);
  assert.equal(status, 201); assert.equal(body.challenge.status, 'draft');
  await serverlessHandler({ method: 'POST', headers: { authorization: `Bearer ${token()}`, 'content-type': 'application/json', 'content-length': String(Buffer.byteLength(JSON.stringify({ challengeId: 'serverless' }))) },
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
    await assertFails(setDoc(doc(db, 'kyrub_admin/control_plane/rate_limits/global-challenges-forged'), { count: 0 }));
    await assertFails(getDoc(doc(db, 'kyrub_admin/control_plane/rate_limits/global-challenges-forged')));
  }
});


test('revocation between verified authorization and Firestore reads, including SDK retries', async t => {
  // Interpose only on the real SDK transaction callback. Reads, commit, rollback,
  // locking and retries still use the actual Firestore Emulator and Admin SDK.
  const db = getFirestore();
  const originalRun = db.runTransaction.bind(db);
  for (const operation of ['create', 'publish']) {
    for (const mode of ['before-read', 'retry']) {
      for (const change of ['demoted', 'disabled', 'deleted']) await t.test(`${operation}-${mode}-${change}`, async context => {
        const uid = `${operation}-${mode}-${change}`;
        const id = `revoke-${uid}`;
        const profile = adminDb.doc(`kyrub_admin/control_plane/admins/${uid}`);
        await profile.set({ uid, role: 'super_admin', status: 'active' });
        if (operation === 'publish') assert.equal((await request(draft(id))).status, 201);
        let attempts = 0;
        let staged = 0;
        const revoke = () => change === 'deleted' ? profile.delete() :
          profile.update(change === 'demoted' ? { role: 'operations' } : { status: 'disabled' });
        const interception = context.mock.method(db, 'runTransaction', (callback: (tx: Transaction) => Promise<unknown>, options: object) =>
          originalRun(async tx => {
            let business = false;
            const proxy = new Proxy(tx, { get(target, property) {
              if (property === 'get') return async (ref: any) => {
                if (ref.path === profile.path) {
                  business = true; attempts++;
                  // On a retry the SDK has already rolled back the first attempt,
                  // so no pessimistic read lock remains when revocation commits.
                  if (mode === 'before-read' || attempts === 2) await revoke();
                }
                return target.get(ref);
              };
              if (property === 'create' || property === 'update') return (...args: any[]) => {
                staged++;
                return (target[property] as Function).apply(target, args);
              };
              const value = Reflect.get(target, property, target);
              return typeof value === 'function' ? value.bind(target) : value;
            } });
            const result = await callback(proxy);
            if (business && mode === 'retry' && attempts === 1) {
              // Deterministic retryable fault after business and audit writes
              // have been staged, before commit. The SDK owns the retry loop.
              throw Object.assign(new Error('TEST_TRANSACTION_ABORTED'), { code: 10 });
            }
            return result;
          }, options));
        try {
          const result = await request(operation === 'create' ? draft(id) : { challengeId: id }, operation, token(uid));
          assert.equal(result.status, 403, JSON.stringify(result));
          assert.equal(attempts, mode === 'retry' ? 2 : 1);
          assert.equal(staged, mode === 'retry' ? 2 : 0);
        } finally { interception.mock.restore(); }
        const stored = await adminDb.doc(`global_challenges/${id}`).get();
        if (operation === 'create') assert.equal(stored.exists, false);
        else {
          assert.equal(stored.data()?.status, 'draft');
          assert.equal(stored.data()?.publishedBy, undefined);
          assert.equal(stored.data()?.publishedAt, undefined);
        }
        assert.equal(await auditCount(id), operation === 'create' ? 0 : 1);
        assert.equal((await adminDb.doc(`global_challenges/${id}/audit/published`).get()).exists, false);
      });
    }
  }
});

test('HTTP payload bound covers raw bytes, chunked bodies, parsed objects and malformed JSON', async () => {
  const boundary = JSON.stringify(draft('payload-boundary'));
  const accepted = await fetch(base, { method: 'POST', headers: { authorization: `Bearer ${token()}`, 'content-type': 'application/json' },
    body: boundary.padEnd(GLOBAL_CHALLENGE_PAYLOAD_BYTES, ' ') });
  assert.equal(accepted.status, 201);
  const oversized = JSON.stringify({ ...draft('too-big'), description: 'a'.repeat(GLOBAL_CHALLENGE_PAYLOAD_BYTES) });
  for (const body of [oversized, ' '.repeat(GLOBAL_CHALLENGE_PAYLOAD_BYTES) + JSON.stringify(draft('whitespace'))]) {
    const response = await fetch(base, { method: 'POST', headers: { 'content-type': 'application/json' }, body });
    assert.equal(response.status, 413); assert.equal((await response.json()).code, 'PAYLOAD_TOO_LARGE');
  }
  const chunked = await fetch(base, { method: 'POST', headers: { 'content-type': 'application/json' },
    body: new ReadableStream({ start(controller) { controller.enqueue(new TextEncoder().encode(oversized)); controller.close(); } }),
    duplex: 'half' } as RequestInit);
  assert.equal(chunked.status, 413);
  const malformed = await fetch(base, { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{' });
  assert.equal(malformed.status, 400); assert.equal(malformed.headers.get('cache-control'), 'no-store');
  let status = 0; let body: any;
  const response = { setHeader() {}, status(n: number) { status = n; return this; }, json(b: unknown) { body = b; } };
  for (const [headers, payload, expected] of [
    [{ 'content-type': 'application/json', 'content-length': '1' }, JSON.parse(oversized), 413],
    [{ 'content-type': 'application/json', 'content-length': String(GLOBAL_CHALLENGE_PAYLOAD_BYTES + 1) }, {}, 413],
    [{ 'content-type': 'application/json' }, {}, 411],
    [{ 'content-type': 'text/plain', 'content-length': '2' }, {}, 415],
  ] as const) {
    await handler({ method: 'POST', headers, body: payload }, response);
    assert.equal(status, expected, JSON.stringify(body));
  }
  assert.equal((await adminDb.doc('global_challenges/too-big').get()).exists, false);
});

test('distributed actor quota is shared by aliases, counts conflicts and resets after window', async () => {
  const uid = 'quota-admin';
  await adminDb.doc(`kyrub_admin/control_plane/admins/${uid}`).set({ uid, role: 'super_admin', status: 'active' });
  const key = createHash('sha256').update(uid).digest('hex');
  const ref = adminDb.doc(`kyrub_admin/control_plane/rate_limits/global-challenges-${key}`);
  // Start at limit minus one and contend for the last allowance. Each handler
  // independently goes through the shared Firestore counter.
  await ref.set({ count: GLOBAL_CHALLENGE_ACTOR_LIMIT - 1, resetAt: Date.now() + 60000 });
  const results = await Promise.all(Array.from({ length: 4 }, (_, i) => request(draft(`quota-${i}`), 'create', token(uid))));
  assert.deepEqual(results.map(x => x.status).sort(), [201, 429, 429, 429]);
  assert.equal((await ref.get()).data()?.count, GLOBAL_CHALLENGE_ACTOR_LIMIT);
  let status = 0; const headers: Record<string, string> = {};
  const response = { setHeader(k: string, v: string) { headers[k] = v; }, status(n: number) { status = n; return this; }, json() {} };
  const body = { challengeId: 'quota-0' };
  await serverlessHandler({ method: 'POST', headers: { authorization: `Bearer ${token(uid)}`, 'content-type': 'application/json', 'content-length': String(JSON.stringify(body).length) },
    query: { transport: 'global-challenges', operation: 'publish' }, body }, response);
  assert.equal(status, 429); assert.ok(Number(headers['retry-after']) > 0);
  await ref.set({ count: GLOBAL_CHALLENGE_ACTOR_LIMIT, resetAt: Date.now() - 1 });
  assert.equal((await request(draft('quota-reset'), 'create', token(uid))).status, 201);
  assert.equal((await ref.get()).data()?.count, 1);
  assert.equal((await request(draft('quota-reset'), 'create', token(uid))).status, 409);
  assert.equal((await ref.get()).data()?.count, 2);
  await ref.set({ count: 'corrupt', resetAt: Date.now() + 60000 });
  assert.equal((await request(draft('quota-corrupt'), 'create', token(uid))).status, 503);
  assert.equal((await adminDb.doc('global_challenges/quota-corrupt').get()).exists, false);
});

test('compiled Vercel rewrite preserves operation=publish through local HTTP and the real multiplexer', async () => {
  const rewriteBase = base.replace('/api/admin/global-challenges', '/vercel-offline/api/admin/global-challenges');
  for (const operation of ['create', 'publish']) {
    const body = operation === 'create' ? draft('compiled-rewrite') : { challengeId: 'compiled-rewrite' };
    const response = await fetch(`${rewriteBase}?operation=${operation}`, { method: 'POST',
      headers: { authorization: `Bearer ${token()}`, 'content-type': 'application/json' }, body: JSON.stringify(body) });
    assert.equal(response.status, operation === 'create' ? 201 : 200, JSON.stringify(await response.clone().json()));
    assert.equal((await response.json()).challenge.status, operation === 'create' ? 'draft' : 'published');
  }
  assert.equal((await adminDb.doc('global_challenges/compiled-rewrite').get()).data()?.status, 'published');
  assert.equal(await auditCount('compiled-rewrite'), 2);
});

test('feature branch deploy block accounts for minimatch slash semantics', async () => {
  const config = JSON.parse(await readFile('vercel.json', 'utf8'));
  for (const branch of ['feat/global-challenge-admin-repository', 'feat/global-challenge-control-plane']) {
  assert.equal(minimatch(branch, '*'), false);
  const matches = Object.entries(config.git.deploymentEnabled).filter(([pattern]) => minimatch(branch, pattern));
  assert.ok(matches.length > 0);
  assert.equal(matches.some(([, allowed]) => allowed === true), false);
  assert.equal(config.git.deploymentEnabled[branch], false);
  }
  assert.equal(config.git.deploymentEnabled.main, true);
});

test('administrative reads paginate with stable IDs, status filters and safe DTOs without writes', async () => {
  const uid = 'read-admin';
  await ensureAuthUser(uid);
  await adminDb.doc(`kyrub_admin/control_plane/admins/${uid}`).set({ uid, role: 'super_admin', status: 'active' });
  const read = async (query: string, bearer = token(uid)) => {
    const response = await fetch(`${base}?${query}`, { headers: { authorization: `Bearer ${bearer}` } });
    assert.equal(response.headers.get('cache-control'), 'no-store');
    return { status: response.status, body: await response.json() };
  };
  for (const id of ['read-a', 'read-b', 'read-c', 'read-d', 'read-e']) {
    await adminDb.doc(`global_challenges/${id}`).set({ ...draft(id), status: 'active', createdBy: 'private-admin', secret: 'not-public', createdAt: new Date().toISOString() });
  }
  const first = await read('operation=list&status=active&limit=2');
  assert.equal(first.status, 200); assert.deepEqual(first.body.items.map((x: any) => x.id), ['read-a', 'read-b']);
  assert.ok(first.body.nextCursor);
  // Deleting the cursor document must not break continuation, and concurrent
  // insertions after the cursor may appear without duplicating earlier items.
  await adminDb.doc('global_challenges/read-b').delete();
  await adminDb.doc('global_challenges/read-cc').set({ ...draft('read-cc'), status: 'active' });
  const second = await read(`status=active&limit=2&cursor=${first.body.nextCursor}`);
  assert.deepEqual(second.body.items.map((x: any) => x.id), ['read-c', 'read-cc']);
  const third = await read(`status=active&limit=2&cursor=${second.body.nextCursor}`);
  assert.deepEqual(third.body.items.map((x: any) => x.id), ['read-d', 'read-e']); assert.equal(third.body.nextCursor, null);
  const rewriteBase = base.replace('/api/admin/global-challenges', '/vercel-offline/api/admin/global-challenges');
  const throughRewrite = await fetch(`${rewriteBase}?operation=get&challengeId=read-a`, { headers: { authorization: `Bearer ${token(uid)}` } });
  assert.equal(throughRewrite.status, 200); assert.equal((await throughRewrite.json()).challenge.id, 'read-a');
  const detail = await read('operation=get&challengeId=read-a');
  assert.equal(detail.status, 200);
  assert.equal(detail.body.challenge.status, 'active');
  for (const item of [...first.body.items, detail.body.challenge]) {
    assert.equal(item.secret, undefined); assert.equal(item.createdBy, undefined); assert.equal(item.createdAt, undefined); assert.equal(item.audit, undefined);
  }
  assert.equal(await auditCount('read-a'), 0);
  const empty = await read('status=ended'); assert.deepEqual(empty.body, { items: [], nextCursor: null });
  assert.equal((await read('operation=get&challengeId=not-found')).status, 404);
  for (const query of ['status=invalid', 'limit=0', 'limit=51', 'limit=1.1', 'limit=2&limit=3', 'status=active&status=draft', 'cursor=invalid',
    'operation=get&challengeId=../unsafe', 'operation=get', 'operation=create', 'operation=list&audit=true', `status=draft&cursor=${first.body.nextCursor}`]) {
    assert.equal((await read(query)).status, 400, query);
  }
  // Read quota uses a distinct record and cannot exhaust the mutation budget.
  const key = createHash('sha256').update(uid).digest('hex');
  const quota = adminDb.doc(`kyrub_admin/control_plane/rate_limits/global-challenges-read-${key}`);
  await quota.set({ count: 60, resetAt: Date.now() + 60000 });
  assert.equal((await read('operation=list')).status, 429);
  assert.equal((await request(draft('read-does-not-spend-write-quota'), 'create', token(uid))).status, 201);
  await adminDb.doc(`kyrub_admin/control_plane/admins/${uid}`).update({ status: 'revoked' });
  assert.equal((await read('operation=list')).status, 403);
});

test('Firebase Auth disable/delete/revocation reject still-signed tokens despite active administrative profiles', async t => {
  for (const state of ['disabled', 'deleted', 'revoked']) await t.test(state, async context => {
    const uid = `identity-${state}`;
    await ensureAuthUser(uid);
    await adminDb.doc(`kyrub_admin/control_plane/admins/${uid}`).set({ uid, role: 'super_admin', status: 'active' });
    const id = `identity-${state}-draft`;
    const captured = token(uid);
    assert.equal((await request(draft(id), 'create', captured)).status, 201, 'same captured token accepted before identity change');
    if (state === 'disabled') await adminAuth.updateUser(uid, { disabled: true });
    if (state === 'deleted') await adminAuth.deleteUser(uid);
    if (state === 'revoked') {
      // Advance only this test process' clock across the SDK's whole-second
      // revocation cutoff. No sleeps, fake Auth responses or production calls.
      const cutoff = Date.now() + 2000;
      context.mock.timers.enable({ apis: ['Date'], now: cutoff });
      await adminAuth.revokeRefreshTokens(uid);
      assert.ok(Date.parse((await adminAuth.getUser(uid)).tokensValidAfterTime) >
        JSON.parse(Buffer.from(captured.split('.')[1], 'base64url').toString()).auth_time * 1000);
    }
    // Send directly: the ordinary fixture helper must not recreate a deleted identity.
    for (const operation of ['create', 'publish']) {
      const response = await fetch(`${base}?operation=${operation}`, { method: 'POST',
        headers: { authorization: `Bearer ${captured}`, 'content-type': 'application/json' },
        body: JSON.stringify(operation === 'create' ? draft(`${id}-blocked`) : { challengeId: id }) });
      assert.equal(response.status, 401, state + ':' + operation);
    }
    for (const query of ['operation=list', `operation=get&challengeId=${id}`]) {
      const response = await fetch(`${base}?${query}`, { headers: { authorization: `Bearer ${captured}` } });
      assert.equal(response.status, 401, state + ':' + query);
    }
    assert.equal((await adminDb.doc(`global_challenges/${id}-blocked`).get()).exists, false);
    assert.equal((await adminDb.doc(`global_challenges/${id}`).get()).data()?.status, 'draft');
    assert.equal(await auditCount(id), 1);
    assert.equal((await adminDb.doc(`kyrub_admin/control_plane/admins/${uid}`).get()).data()?.status, 'active');
    if (state === 'revoked') {
      // Re-authentication after the cutoff restores identity validity, not extra roles.
      assert.equal((await request(draft(`${id}-reauthenticated`), 'create', token(uid))).status, 201);
    }
  });
});

test('identity backend failures fail closed without business writes or backend detail disclosure', async context => {
  const fault = context.mock.method(getAuth(), 'getUser', async () => { throw new Error('TEST_PRIVATE_BACKEND_FAILURE'); });
  try {
    const response = await fetch(`${base}?operation=create`, { method: 'POST',
      headers: { authorization: `Bearer ${token()}`, 'content-type': 'application/json' },
      body: JSON.stringify(draft('identity-unavailable')) });
    assert.equal(response.status, 503);
    assert.deepEqual(await response.json(), { code: 'GLOBAL_CHALLENGE_UNAVAILABLE' });
    assert.equal((await adminDb.doc('global_challenges/identity-unavailable').get()).exists, false);
    assert.equal(await auditCount('identity-unavailable'), 0);
  } finally { fault.mock.restore(); }
});

test('Express admission charges one slot per request, including parser errors', async context => {
  const admission = context.mock.method(MemoryStore.prototype, 'increment');
  try {
    assert.equal((await request(draft('admission-once'))).status, 201);
    assert.equal(admission.mock.callCount(), 1);
    const oversized = await fetch(base, { method: 'POST', headers: { 'content-type': 'application/json' },
      body: ' '.repeat(GLOBAL_CHALLENGE_PAYLOAD_BYTES + 1) });
    assert.equal(oversized.status, 413);
    assert.equal(admission.mock.callCount(), 2);
  } finally { admission.mock.restore(); }
});

test('malformed and oversized HTTP requests cannot bypass pre-parser ingress admission', async () => {
  let blocked = false;
  for (let i = 0; i <= GLOBAL_CHALLENGE_INGRESS_LIMIT; i++) {
    const response = await fetch(base, { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{' });
    if (response.status === 429) { assert.ok(Number(response.headers.get('retry-after')) > 0); blocked = true; break; }
    assert.equal(response.status, 400);
  }
  assert.equal(blocked, true, 'invalid JSON must consume the same admission budget');
});

test('ingress limit rejects unauthenticated floods without trusting forwarded headers', async () => {
  // Last test: exercise the actual configured cap, with different fake source IPs.
  let blocked = false;
  for (let i = 0; i <= GLOBAL_CHALLENGE_INGRESS_LIMIT; i++) {
    const response = await fetch(base, { method: 'POST', headers: { 'content-type': 'application/json', 'x-forwarded-for': `192.0.2.${i % 255}` }, body: '{}' });
    if (response.status === 429) {
      assert.ok(Number(response.headers.get('retry-after')) > 0);
      blocked = true; break;
    }
    assert.equal(response.status, 401);
  }
  assert.equal(blocked, true);
});
