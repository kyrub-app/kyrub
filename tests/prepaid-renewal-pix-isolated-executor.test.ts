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
