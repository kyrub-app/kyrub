import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import test from 'node:test';
import { executeAuthorityGuardedIsolatedPrepaidRenewalPix } from '../server/payments/prepaidRenewalPixAuthorityGuardedExecutor.js';

const storeId = 'store-a';
const proposalId = 'a'.repeat(64);
const expiresAt = new Date(Date.now() + 600_000).toISOString();
const request = {
  path: '/v1/payments' as const,
  init: {
    method: 'POST' as const,
    headers: { 'X-Idempotency-Key': `prepaid-renewal-${proposalId}` },
    body: JSON.stringify({
      transaction_amount: 29.9,
      payment_method_id: 'pix',
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
  currency_id: 'BRL', collector_id: 7654321, transaction_amount: 29.9,
  external_reference: `kyrub:prepaid-renewal:${storeId}:${proposalId}`,
};
const run = (overrides: Record<string, unknown> = {}) => {
  const calls: string[] = [];
  const input = {
    storeId, proposalId, request,
    trustedCredentialScopeId: 'owner-a',
    oauthCredentialScopeId: 'owner-a',
    trustedExternalAccountId: '7654321',
    oauthExternalAccountId: '7654321',
    reserve: async () => { calls.push('reserve'); return { attempt }; },
    createPayment: async () => { calls.push('create'); return response; },
    fetchPayment: async () => { calls.push('fetch'); return response; },
    bindPayment: async () => { calls.push('bind'); return 'bound' as const; },
    ...overrides,
  };
  return { calls, execute: () => executeAuthorityGuardedIsolatedPrepaidRenewalPix(input) };
};
test('matching authority reaches reservation and binds verified payment', async () => {
  const { calls, execute } = run();
  assert.deepEqual(await execute(), { paymentId: '123456', binding: 'bound' });
  assert.deepEqual(calls, ['reserve', 'create', 'bind']);
});
test('mismatched OAuth account stops before reservation and transport', async () => {
  const { calls, execute } = run({ oauthExternalAccountId: '999999' });
  await assert.rejects(execute(), /RENEWAL_PIX_TRANSPORT_AUTHORITY_MISMATCH/);
  assert.deepEqual(calls, []);
});
test('mismatched credential scope stops before reservation and transport', async () => {
  const { calls, execute } = run({ oauthCredentialScopeId: 'other-owner' });
  await assert.rejects(execute(), /RENEWAL_PIX_TRANSPORT_AUTHORITY_MISMATCH/);
  assert.deepEqual(calls, []);
});
test('forged collector is rejected before binding', async () => {
  const { calls, execute } = run({ createPayment: async () => { calls.push('create'); return { ...response, collector_id: 999999 }; } });
  await assert.rejects(execute(), /RENEWAL_PIX_CREATION_RESPONSE_MISMATCH/);
  assert.deepEqual(calls, ['reserve', 'create']);
});
