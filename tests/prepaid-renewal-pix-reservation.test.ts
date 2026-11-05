import assert from 'node:assert/strict';
import test from 'node:test';
import { build } from 'esbuild';
import { createHash } from 'node:crypto';
import { decidePrepaidRenewalPixAttempt } from '../server/payments/prepaidRenewalPixAttempt.js';

const proposalId = 'a'.repeat(64);
const storeId = 'store-a';
const acceptedAt = new Date(Date.now() - 60_000).toISOString();
const expiry = new Date(Date.parse(acceptedAt) + 30 * 60_000).toISOString();
const embeddedProposal = { customerId: 'buyer-a', storeId, previousContractId: 'old-contract', totalDueMinor: 29990 };
const proposal = {
  status: 'accepted', acceptedBy: 'buyer-a', acceptedAt,
  acceptedProposalDigest: createHash('sha256').update(JSON.stringify(embeddedProposal)).digest('hex'),
  paymentExternalReference: `kyrub:prepaid-renewal:${storeId}:${proposalId}`,
  acceptance: { customerId: 'buyer-a', storeId, acceptedTotalMinor: 29990, acceptedAt },
  proposal: embeddedProposal,
};
const store = new Map<string, Record<string, unknown>>([
  [`stores/${storeId}/prepaidRenewalProposals/${proposalId}`, proposal],
]);
let lock = Promise.resolve();
const db = {
  doc: (path: string) => ({ path }),
  runTransaction: async (fn: (tx: unknown) => Promise<unknown>) => {
    const previous = lock;
    let unlock!: () => void;
    lock = new Promise<void>(resolve => { unlock = resolve; });
    await previous;
    try {
      const pending: Array<() => void> = [];
      const tx = {
        get: async (ref: { path: string }) => ({
          exists: store.has(ref.path),
          data: () => store.get(ref.path),
          get: (field: string) => store.get(ref.path)?.[field],
        }),
        create: (ref: { path: string }, data: Record<string, unknown>) => {
          pending.push(() => {
            if (store.has(ref.path)) throw new Error('ALREADY_EXISTS');
            store.set(ref.path, data);
          });
        },
      };
      const result = await fn(tx);
      for (const write of pending) write();
      return result;
    } finally { unlock(); }
  },
};
const bundle = await build({
  entryPoints: ['server/payments/prepaidRenewalPixAttemptReservation.ts'],
  bundle: true, platform: 'node', format: 'esm', write: false,
  plugins: [{
    name: 'isolated-firestore',
    setup(plugin) {
      plugin.onResolve({ filter: /firebaseAdmin\.js$/ }, args =>
        ({ path: args.path, namespace: 'isolated-firestore' }));
      plugin.onLoad({ filter: /.*/, namespace: 'isolated-firestore' }, () =>
        ({ contents: 'export const adminDb = globalThis.__isolatedRenewalDb;', loader: 'js' }));
    },
  }],
});
(globalThis as Record<string, unknown>).__isolatedRenewalDb = db;
const source = Buffer.from(bundle.outputFiles[0].text).toString('base64');
const { reservePrepaidRenewalPixAttempt } = await import(`data:text/javascript;base64,${source}`);
const request = {
  path: '/v1/payments' as const,
  init: {
    method: 'POST' as const,
    headers: { 'X-Idempotency-Key': `prepaid-renewal-${proposalId}` },
    body: JSON.stringify({
      transaction_amount: 299.9, date_of_expiration: expiry,
      external_reference: proposal.paymentExternalReference,
      metadata: { kyrub_store_id: storeId, kyrub_prepaid_renewal_proposal_id: proposalId },
    }),
  },
};
test('two simultaneous reservation requests create exactly one attempt', async () => {
  const results = await Promise.all([
    reservePrepaidRenewalPixAttempt({ storeId, proposalId, request }),
    reservePrepaidRenewalPixAttempt({ storeId, proposalId, request }),
  ]);
  assert.deepEqual(results.map((x: { action: string }) => x.action).sort(), ['create', 'reuse']);
  assert.equal([...store.keys()].filter(key => key.includes('prepaidRenewalPixAttempts')).length, 2);
});
test('conflicting concurrent retry cannot mutate the reserved attempt', async () => {
  const altered = {
    ...request, init: { ...request.init, body: request.init.body.replace('299.9', '199.9') },
  };
  await assert.rejects(reservePrepaidRenewalPixAttempt({
    storeId, proposalId, request: altered,
  }), /RENEWAL_PIX_ATTEMPT_INVALID/);
  assert.equal([...store.keys()].filter(key => key.includes('prepaidRenewalPixAttempts')).length, 2);
});

test('reservation rejects a missing accepted proposal without writing an attempt', async () => {
  const path = `stores/${storeId}/prepaidRenewalProposals/${proposalId}`;
  const saved = store.get(path);
  store.delete(path);
  try {
    await assert.rejects(reservePrepaidRenewalPixAttempt({
      storeId, proposalId, request,
    }), /RENEWAL_PIX_ACCEPTANCE_REQUIRED/);
  } finally {
    if (saved) store.set(path, saved);
  }
});

test('reservation rejects a tampered accepted proposal digest', async () => {
  const path = `stores/${storeId}/prepaidRenewalProposals/${proposalId}`;
  const saved = store.get(path);
  store.set(path, { ...saved, acceptedProposalDigest: '0'.repeat(64) });
  try {
    await assert.rejects(reservePrepaidRenewalPixAttempt({
      storeId, proposalId, request,
    }), /RENEWAL_PIX_ACCEPTANCE_REQUIRED/);
  } finally {
    if (saved) store.set(path, saved);
  }
});

test('reservation rejects cross-store request before writing anything', async () => {
  await assert.rejects(reservePrepaidRenewalPixAttempt({
    storeId: 'other-store', proposalId, request,
  }), /RENEWAL_PIX_ACCEPTANCE_REQUIRED/);
  assert.equal([...store.keys()].filter(key => key.includes('prepaidRenewalPixAttempts')).length, 2);
});

for (const invalidBody of ['null', '[]', '"unexpected"', '123', 'true']) {
  test(`transactional Pix reservation rejects non-object JSON ${invalidBody} without writing`, async () => {
    const before = [...store.keys()].filter(key => key.includes('prepaidRenewalPixAttempts')).length;
    await assert.rejects(reservePrepaidRenewalPixAttempt({
      storeId, proposalId,
      request: { ...request, init: { ...request.init, body: invalidBody } },
    }), /RENEWAL_PIX_ATTEMPT_INVALID/);
    assert.equal([...store.keys()].filter(key => key.includes('prepaidRenewalPixAttempts')).length, before);
  });
}

test('expired bound Pix reservation remains recoverable but unbound attempt cannot retry', () => {
  const expired = new Date(Date.now() - 60_000).toISOString();
  const body = JSON.parse(request.init.body);
  body.date_of_expiration = expired;
  const expiredRequest = { ...request, init: { ...request.init, body: JSON.stringify(body) } };
  const existing = {
    storeId, proposalId, status: 'reserved' as const,
    idempotencyKey: `prepaid-renewal-${proposalId}`,
    requestDigest: createHash('sha256').update(expiredRequest.init.body).digest('hex'),
    expiresAt: expired, providerPaymentId: '123456',
  };
  assert.equal(decidePrepaidRenewalPixAttempt({
    storeId, proposalId, request: expiredRequest, existing,
  }).action, 'reuse');
  assert.throws(() => decidePrepaidRenewalPixAttempt({
    storeId, proposalId, request: expiredRequest,
    existing: { ...existing, providerPaymentId: undefined },
  }), /RENEWAL_PIX_ATTEMPT_EXPIRED/);
});
