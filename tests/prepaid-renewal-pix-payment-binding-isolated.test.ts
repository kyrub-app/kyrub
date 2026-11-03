import assert from 'node:assert/strict';
import test from 'node:test';
import { build } from 'esbuild';

const storeId = 'store-a';
const proposalId = 'a'.repeat(64);
const path = `stores/${storeId}/prepaidRenewalPixAttempts/${proposalId}`;
const digest = 'b'.repeat(64);
const records = new Map<string, Record<string, unknown>>([
  [path, {
    storeId, proposalId, status: 'reserved',
    idempotencyKey: `prepaid-renewal-${proposalId}`,
    requestDigest: digest,
  }],
]);
let lock = Promise.resolve();
const db = {
  doc: (documentPath: string) => ({ path: documentPath }),
  runTransaction: async (fn: (tx: unknown) => Promise<unknown>) => {
    const previous = lock;
    let unlock!: () => void;
    lock = new Promise<void>(resolve => { unlock = resolve; });
    await previous;
    try {
      const pending: Array<() => void> = [];
      const tx = {
        get: async (ref: { path: string }) => ({
          exists: records.has(ref.path),
          data: () => records.get(ref.path),
        }),
        update: (ref: { path: string }, changes: Record<string, unknown>) => {
          pending.push(() => records.set(ref.path, { ...records.get(ref.path), ...changes }));
        },
      };
      const result = await fn(tx);
      for (const write of pending) write();
      return result;
    } finally { unlock(); }
  },
};
const bundle = await build({
  entryPoints: ['server/payments/prepaidRenewalPixPaymentIdBinding.ts'],
  bundle: true, platform: 'node', format: 'esm', write: false,
  plugins: [{
    name: 'isolated-firestore',
    setup(plugin) {
      plugin.onResolve({ filter: /firebaseAdmin\.js$/ }, args =>
        ({ path: args.path, namespace: 'isolated-firestore' }));
      plugin.onLoad({ filter: /.*/, namespace: 'isolated-firestore' }, () =>
        ({ contents: 'export const adminDb = globalThis.__isolatedPixBindingDb;', loader: 'js' }));
    },
  }],
});
(globalThis as Record<string, unknown>).__isolatedPixBindingDb = db;
const source = Buffer.from(bundle.outputFiles[0].text).toString('base64');
const { bindCreatedPrepaidRenewalPixPaymentId } = await import(`data:text/javascript;base64,${source}`);
const bind = (paymentId: string, expectedRequestDigest = digest) =>
  bindCreatedPrepaidRenewalPixPaymentId({ storeId, proposalId, paymentId, expectedRequestDigest });

test('competing payment IDs permit only one immutable Firestore binding', async () => {
  const outcomes = await Promise.allSettled([bind('111'), bind('222')]);
  assert.equal(outcomes.filter(x => x.status === 'fulfilled').length, 1);
  assert.equal(outcomes.filter(x => x.status === 'rejected').length, 1);
  const winner = records.get(path)?.providerPaymentId as string;
  assert.ok(['111', '222'].includes(winner));
  const loser = winner === '111' ? '222' : '111';
  await assert.rejects(bind(loser), /RENEWAL_PIX_PAYMENT_BINDING_CONFLICT/);
  assert.equal(records.get(path)?.providerPaymentId, winner);
  assert.equal(await bind(winner), 'already_bound');
});

test('binding rejects altered digest and cross-store without mutation', async () => {
  const before = { ...records.get(path) };
  await assert.rejects(bind('333', '0'.repeat(64)), /RENEWAL_PIX_PAYMENT_BINDING_CONFLICT/);
  await assert.rejects(bindCreatedPrepaidRenewalPixPaymentId({
    storeId: 'other-store', proposalId, paymentId: '333', expectedRequestDigest: digest,
  }), /RENEWAL_PIX_PAYMENT_BINDING_CONFLICT/);
  assert.deepEqual(records.get(path), before);
});
