import assert from 'node:assert/strict';
import { beforeEach, test } from 'node:test';
import { build } from 'esbuild';

const docs = new Map<string, any>();
let writes = 0;
const snapshot = (path: string) => ({ id: path.split('/').at(-1), exists: docs.has(path), data: () => docs.get(path) });
const db = {
  doc: (path: string) => ({ path }),
  collection: (path: string) => ({ get: async () => ({ docs: [...docs.keys()]
    .filter(key => key.startsWith(path + '/')).map(snapshot) }) }),
  runTransaction: async (callback: any) => callback({
    get: async (ref: any) => snapshot(ref.path),
    create: (ref: any, data: any) => { assert(!docs.has(ref.path)); docs.set(ref.path, data); writes++; },
  }),
};
(globalThis as any).__xpLedgerTest = db;
const bundle = await build({
  entryPoints: ['server/gamification/xpLedgerRepository.ts'], bundle: true, platform: 'node', format: 'esm', write: false,
  plugins: [{ name: 'isolated-xp', setup(b) {
    b.onResolve({ filter: /firebaseAdmin\.js$|^firebase-admin\/firestore$/ }, args => ({ path: args.path, namespace: 'mock' }));
    b.onLoad({ filter: /.*/, namespace: 'mock' }, args => ({ contents: args.path.endsWith('firebaseAdmin.js')
      ? 'export const adminDb = globalThis.__xpLedgerTest;'
      : 'export const FieldValue = { serverTimestamp: () => "SERVER_TIME" };' }));
  } }],
});
const api = await import('data:text/javascript;base64,' + Buffer.from(bundle.outputFiles[0].text).toString('base64'));
const input = { userId: 'buyer', sourceType: 'community', sourceId: 'community-1', deltaXp: 10,
  correlationId: 'event-1', idempotencyKey: 'event-1', occurredAt: '2026-11-05T12:00:00.000Z' };
beforeEach(() => { docs.clear(); writes = 0; });

test('verified event replay creates one XP entry and preserves the total', async () => {
  const first = await api.persistVerifiedKyrubXp(input);
  assert.deepEqual(await api.persistVerifiedKyrubXp(input), first);
  assert.equal(writes, 1);
  assert.deepEqual(await api.readVerifiedKyrubXpTotal(' buyer '), { total: 10, entryCount: 1 });
  assert.deepEqual(await api.readVerifiedKyrubXpTotal('other'), { total: null, entryCount: 0 });
});

test('reusing an event with a different reward fails without changing its value', async () => {
  await api.persistVerifiedKyrubXp(input);
  await assert.rejects(api.persistVerifiedKyrubXp({ ...input, deltaXp: 100 }), /IDEMPOTENCY_CONFLICT/);
  assert.equal(writes, 1);
  assert.equal((await api.readVerifiedKyrubXpTotal('buyer')).total, 10);
});

test('invalid events and foreign entries fail closed', async () => {
  for (const patch of [{ userId: '../other' }, { deltaXp: 0 }, { deltaXp: 1.1 },
    { sourceType: 'payment' }, { occurredAt: 'invalid' }]) {
    await assert.rejects(api.persistVerifiedKyrubXp({ ...input, ...patch }));
  }
  assert.equal(writes, 0);
  docs.set('users/buyer/xpLedger/xp_event-1', { ...input, id: 'xp_event-1', userId: 'other' });
  await assert.rejects(api.readVerifiedKyrubXpTotal('buyer'), /SCOPE_INVALID/);
});
