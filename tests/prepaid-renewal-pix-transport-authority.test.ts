import assert from 'node:assert/strict';
import test from 'node:test';
import { validatePrepaidRenewalPixTransportAuthority } from '../server/payments/prepaidRenewalPixTransportAuthority.js';

const proposalId = 'a'.repeat(64);
const storeId = 'store-a';
const request = {
  path: '/v1/payments' as const,
  init: {
    method: 'POST' as const,
    headers: { 'X-Idempotency-Key': `prepaid-renewal-${proposalId}` },
    body: JSON.stringify({
      transaction_amount: 299.9,
      payment_method_id: 'pix',
      external_reference: `kyrub:prepaid-renewal:${storeId}:${proposalId}`,
      metadata: { kyrub_store_id: storeId, kyrub_prepaid_renewal_proposal_id: proposalId },
    }),
  },
};
const valid = {
  storeId, proposalId, request,
  trustedCredentialScopeId: 'owner-a',
  oauthCredentialScopeId: 'owner-a',
  trustedExternalAccountId: '123456',
  oauthExternalAccountId: '123456',
};
test('transport preflight accepts matching verified seller identities', () => {
  assert.doesNotThrow(() => validatePrepaidRenewalPixTransportAuthority(valid));
});
test('transport preflight rejects OAuth seller account mismatch', () => {
  assert.throws(() => validatePrepaidRenewalPixTransportAuthority({
    ...valid, oauthExternalAccountId: '999999',
  }), /RENEWAL_PIX_TRANSPORT_AUTHORITY_MISMATCH/);
});
test('transport preflight rejects OAuth credential scope mismatch', () => {
  assert.throws(() => validatePrepaidRenewalPixTransportAuthority({
    ...valid, oauthCredentialScopeId: 'owner-b',
  }), /RENEWAL_PIX_TRANSPORT_AUTHORITY_MISMATCH/);
});
test('transport preflight rejects cross-store payment metadata', () => {
  const body = JSON.parse(request.init.body);
  body.metadata.kyrub_store_id = 'store-b';
  assert.throws(() => validatePrepaidRenewalPixTransportAuthority({
    ...valid, request: { ...request, init: { ...request.init, body: JSON.stringify(body) } },
  }), /RENEWAL_PIX_TRANSPORT_AUTHORITY_MISMATCH/);
});
test('transport preflight rejects non-Pix and altered idempotency key', () => {
  const body = JSON.parse(request.init.body);
  body.payment_method_id = 'credit_card';
  assert.throws(() => validatePrepaidRenewalPixTransportAuthority({
    ...valid, request: { ...request, init: { ...request.init, body: JSON.stringify(body) } },
  }), /RENEWAL_PIX_TRANSPORT_AUTHORITY_MISMATCH/);
  assert.throws(() => validatePrepaidRenewalPixTransportAuthority({
    ...valid, request: { ...request, init: { ...request.init, headers: { 'X-Idempotency-Key': 'other' } } },
  }), /RENEWAL_PIX_TRANSPORT_AUTHORITY_MISMATCH/);
});
