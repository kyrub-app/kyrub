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

test('rejects provider metadata inconsistent with the accepted store and proposal', () => {
  assert.throws(() => verify({
    metadata: {
      kyrub_store_id: 'other-store',
      kyrub_prepaid_renewal_proposal_id: proposalId,
    },
  }), /RENEWAL_PIX_CREATION_RESPONSE_MISMATCH/);
  assert.throws(() => verify({
    metadata: {
      kyrub_store_id: storeId,
      kyrub_prepaid_renewal_proposal_id: 'other-proposal',
    },
  }), /RENEWAL_PIX_CREATION_RESPONSE_MISMATCH/);
  assert.equal(verify({
    metadata: {
      kyrub_store_id: storeId,
      kyrub_prepaid_renewal_proposal_id: proposalId,
    },
  }), '123456');
});

for (const invalidBody of ['null', '[]', '"invalid"', '123', 'true']) {
  test(`Pix creation response rejects malformed request JSON ${invalidBody}`, () => {
    const malformedRequest = {
      ...request,
      init: { ...request.init, body: invalidBody },
    };
    assert.throws(() => validatePrepaidRenewalPixCreationResponse({
      request: malformedRequest, response,
      expectedStoreId: storeId, expectedProposalId: proposalId,
      expectedCollectorId: '7654321',
    }), /RENEWAL_PIX_CREATION_RESPONSE_MISMATCH/);
  });
}
