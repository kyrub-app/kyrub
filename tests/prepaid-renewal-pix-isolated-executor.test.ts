import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { test } from 'node:test';
import { executeIsolatedPrepaidRenewalPix } from '../server/payments/prepaidRenewalPixIsolatedExecutor.js';

const proposalId = 'a'.repeat(64);
const storeId = 'store-a';
const expiresAt = new Date(Date.now() + 600_000).toISOString();
const request = {
  path: '/v1/payments' as const,
  init: {
    method: 'POST' as const,
    headers: { 'X-Idempotency-Key': `prepaid-renewal-${proposalId}` },
    body: JSON.stringify({
      transaction_amount: 299.9,
      date_of_expiration: expiresAt,
      external_reference: `kyrub:prepaid-renewal:${storeId}:${proposalId}`,
      metadata: { kyrub_store_id: storeId, kyrub_prepaid_renewal_proposal_id: proposalId },
    }),
  },
};
const attempt = {
  storeId, proposalId, status: 'reserved' as const,
  idempotencyKey: `prepaid-renewal-${proposalId}`,
  requestDigest: createHash('sha256').update(request.init.body).digest('hex'),
  expiresAt,
};
const response = {
  id: 123456, status: 'pending', payment_method_id: 'pix',
  currency_id: 'BRL', collector_id: 7654321,
  transaction_amount: 299.9,
  external_reference: `kyrub:prepaid-renewal:${storeId}:${proposalId}`,
};
test('isolated executor creates and binds a validated provider response', async () => {
  let posts = 0;
  let binds = 0;
  const result = await executeIsolatedPrepaidRenewalPix({
    storeId, proposalId, request, expectedCollectorId: '7654321',
    reserve: async () => ({ attempt }),
    createPayment: async () => { posts++; return response; },
    fetchPayment: async () => { throw new Error('UNEXPECTED_FETCH'); },
    bindPayment: async id => { assert.equal(id, '123456'); binds++; return 'bound'; },
  });
  assert.deepEqual(result, { paymentId: '123456', binding: 'bound' });
  assert.equal(posts, 1);
  assert.equal(binds, 1);
});
test('isolated executor fetches a previously bound payment without posting', async () => {
  const result = await executeIsolatedPrepaidRenewalPix({
    storeId, proposalId, request, expectedCollectorId: '7654321',
    reserve: async () => ({ attempt: { ...attempt, providerPaymentId: '123456' } }),
    createPayment: async () => { throw new Error('DUPLICATE_POST'); },
    fetchPayment: async id => { assert.equal(id, '123456'); return response; },
    bindPayment: async () => 'already_bound',
  });
  assert.equal(result.binding, 'already_bound');
});
test('isolated executor refuses provider identity mismatch without binding', async () => {
  let bound = false;
  await assert.rejects(executeIsolatedPrepaidRenewalPix({
    storeId, proposalId, request, expectedCollectorId: '7654321',
    reserve: async () => ({ attempt }),
    createPayment: async () => ({ ...response, collector_id: 42 }),
    fetchPayment: async () => response,
    bindPayment: async () => { bound = true; return 'bound'; },
  }), /RENEWAL_PIX_CREATION_RESPONSE_MISMATCH/);
  assert.equal(bound, false);
});
test('isolated executor fails closed before network on altered reservation digest', async () => {
  let called = false;
  await assert.rejects(executeIsolatedPrepaidRenewalPix({
    storeId, proposalId, request, expectedCollectorId: '7654321',
    reserve: async () => ({ attempt: { ...attempt, requestDigest: '0'.repeat(64) } }),
    createPayment: async () => { called = true; return response; },
    fetchPayment: async () => { called = true; return response; },
    bindPayment: async () => { called = true; return 'bound'; },
  }), /RENEWAL_PIX_RECOVERY_CONFLICT/);
  assert.equal(called, false);
});

test('isolated executor recovers a lost response using the same provider payment', async () => {
  const payments = new Map<string, typeof response>();
  let posts = 0;
  let boundPaymentId: string | undefined;
  const run = () => executeIsolatedPrepaidRenewalPix({
    storeId, proposalId, request, expectedCollectorId: '7654321',
    reserve: async () => ({ attempt: { ...attempt, providerPaymentId: boundPaymentId } }),
    createPayment: async value => {
      posts++;
      const key = value.init.headers['X-Idempotency-Key'];
      const prior = payments.get(key);
      if (prior) return prior;
      payments.set(key, response);
      throw new Error('SIMULATED_LOST_RESPONSE');
    },
    fetchPayment: async () => response,
    bindPayment: async id => { boundPaymentId = id; return 'bound'; },
  });
  await assert.rejects(run(), /SIMULATED_LOST_RESPONSE/);
  assert.equal(payments.size, 1);
  assert.equal(boundPaymentId, undefined);
  const recovered = await run();
  assert.equal(recovered.paymentId, '123456');
  assert.equal(boundPaymentId, '123456');
  assert.equal(posts, 2);
  assert.equal(payments.size, 1);
  const afterBinding = await run();
  assert.equal(afterBinding.paymentId, '123456');
  assert.equal(posts, 2);
});
test('isolated executor rejects a fetched payment with a different ID', async () => {
  let bound = false;
  await assert.rejects(executeIsolatedPrepaidRenewalPix({
    storeId, proposalId, request, expectedCollectorId: '7654321',
    reserve: async () => ({ attempt: { ...attempt, providerPaymentId: '123456' } }),
    createPayment: async () => { throw new Error('UNEXPECTED_POST'); },
    fetchPayment: async () => ({ ...response, id: 654321 }),
    bindPayment: async () => { bound = true; return 'already_bound'; },
  }), /RENEWAL_PIX_RECOVERY_CONFLICT/);
  assert.equal(bound, false);
});

test('concurrent isolated executions preserve one provider ID and immutable binding', async () => {
  const provider = new Map<string, typeof response>();
  let boundId: string | undefined;
  let providerCreates = 0;
  let successfulBindings = 0;
  const execute = () => executeIsolatedPrepaidRenewalPix({
    storeId, proposalId, request, expectedCollectorId: '7654321',
    reserve: async () => ({ attempt: { ...attempt, providerPaymentId: boundId } }),
    createPayment: async value => {
      const key = value.init.headers['X-Idempotency-Key'];
      const existing = provider.get(key);
      if (existing) return existing;
      providerCreates++;
      provider.set(key, response);
      return response;
    },
    fetchPayment: async id => {
      assert.equal(id, '123456');
      return response;
    },
    bindPayment: async id => {
      if (boundId && boundId !== id) throw new Error('IMMUTABLE_BINDING_CONFLICT');
      const action = boundId ? 'already_bound' as const : 'bound' as const;
      boundId = id;
      successfulBindings++;
      return action;
    },
  });
  const results = await Promise.all(Array.from({ length: 8 }, execute));
  assert.equal(providerCreates, 1);
  assert.equal(provider.size, 1);
  assert.equal(boundId, '123456');
  assert.equal(successfulBindings, 8);
  assert.ok(results.every(result => result.paymentId === '123456'));
});
