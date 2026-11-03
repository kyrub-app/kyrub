import assert from 'node:assert/strict';
import { test } from 'node:test';
import { validatePrepaidRenewalPixCreationResponse } from '../server/payments/prepaidRenewalPixCreationResponse.js';

const proposalId = 'a'.repeat(64);
const storeId = 'store-a';
const request = {
  path: '/v1/payments' as const,
  init: {
    method: 'POST' as const,
    headers: { 'X-Idempotency-Key': `prepaid-renewal-${proposalId}` },
    body: JSON.stringify({
      transaction_amount: 299.9,
      external_reference: `kyrub:prepaid-renewal:${storeId}:${proposalId}`,
      metadata: { kyrub_store_id: storeId, kyrub_prepaid_renewal_proposal_id: proposalId },
    }),
  },
};
const response = {
  id: 123456, status: 'pending', payment_method_id: 'pix',
  currency_id: 'BRL', collector_id: 7654321,
  transaction_amount: 299.9,
  external_reference: `kyrub:prepaid-renewal:${storeId}:${proposalId}`,
};
const verify = (changes: Record<string, unknown> = {}) =>
  validatePrepaidRenewalPixCreationResponse({
    request, response: { ...response, ...changes },
    expectedStoreId: storeId, expectedProposalId: proposalId,
    expectedCollectorId: '7654321',
  });
test('trusted Pix creation response binds seller, amount and proposal', () => {
  assert.equal(verify(), '123456');
});
test('rejects mismatched seller, reference, amount, method and currency', () => {
  for (const changes of [
    { collector_id: 42 },
    { external_reference: 'other' },
    { transaction_amount: 299.89 },
    { payment_method_id: 'credit_card' },
    { currency_id: 'USD' },
    { id: 'not-a-number' },
    { status: 'rejected' },
  ]) assert.throws(() => verify(changes), /RENEWAL_PIX_CREATION_RESPONSE_MISMATCH/);
});
