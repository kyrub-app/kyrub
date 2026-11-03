import assert from 'node:assert/strict';
import test from 'node:test';
import { assertSamePrepaidRenewalPixAttempt, buildPrepaidRenewalPixRequest } from '../server/payments/prepaidRenewalPixRequest.js';
import { prepaidRenewalPixExpiryFromAcceptance } from '../server/payments/prepaidRenewalPixExpiry.js';

const proposalId = 'a'.repeat(64);
const valid = () => ({
  storeId: 'store-a', proposalId,
  acceptedBuyerId: 'buyer-a', authenticatedBuyerId: 'buyer-a',
  acceptedTotalMinor: 29990, proposalTotalMinor: 29990,
  sellerCredentialScopeId: 'store-a',
  paymentExternalReference: `kyrub:prepaid-renewal:store-a:${proposalId}`,
  payerEmail: 'buyer@example.com',
  expiresAt: '2099-11-03T12:00:00.000Z',
});

test('renewal Pix request retains seller and immutable accepted proposal binding', () => {
  const request = buildPrepaidRenewalPixRequest(valid());
  assert.equal(request.path, '/v1/payments');
  assert.equal(request.init.method, 'POST');
  assert.equal(request.init.headers['X-Idempotency-Key'], `prepaid-renewal-${proposalId}`);
  const body = JSON.parse(request.init.body);
  assert.equal(body.transaction_amount, 299.9);
  assert.equal(body.external_reference, valid().paymentExternalReference);
  assert.equal(body.metadata.kyrub_store_id, 'store-a');
  assert.equal(body.metadata.kyrub_prepaid_renewal_proposal_id, proposalId);
  assert.equal(body.payment_method_id, 'pix');
});

test('renewal Pix request rejects buyer, merchant, amount, reference and expiry mismatches', () => {
  const invalid = [
    { authenticatedBuyerId: 'other-buyer' },
    { sellerCredentialScopeId: 'other-store' },
    { acceptedTotalMinor: 100 },
    { paymentExternalReference: 'different' },
    { expiresAt: '2020-01-01T00:00:00.000Z' },
    { payerEmail: 'not-an-email' },
  ];
  for (const change of invalid) {
    assert.throws(() => buildPrepaidRenewalPixRequest({ ...valid(), ...change }),
      /INVALID_PREPAID_RENEWAL_PIX_BINDING/, JSON.stringify(change));
  }
});

test('renewal Pix payload is deterministic for the same persisted payment attempt', () => {
  const first = buildPrepaidRenewalPixRequest(valid());
  const retry = buildPrepaidRenewalPixRequest(valid());
  assert.deepEqual(retry, first);
  assert.doesNotThrow(() => assertSamePrepaidRenewalPixAttempt(first, retry));
});

test('renewal Pix retry with a changed expiry must not be submitted under the same idempotency key', () => {
  const first = buildPrepaidRenewalPixRequest(valid());
  const later = buildPrepaidRenewalPixRequest({
    ...valid(), expiresAt: '2099-11-03T12:30:00.000Z',
  });
  assert.equal(first.init.headers['X-Idempotency-Key'], later.init.headers['X-Idempotency-Key']);
  assert.notEqual(first.init.body, later.init.body);
  assert.throws(() => assertSamePrepaidRenewalPixAttempt(first, later), /RENEWAL_PIX_ATTEMPT_PAYLOAD_CHANGED/);
  // The executor must persist and reuse one exact payload for an attempt;
  // this test records the unsafe scenario until that execution gate exists.
});

test('accepted renewal timestamp yields stable Pix expiry across retries', () => {
  const acceptedAt = '2026-11-03T12:00:00.000Z';
  const first = prepaidRenewalPixExpiryFromAcceptance(acceptedAt, Date.parse('2026-11-03T12:01:00.000Z'));
  const retry = prepaidRenewalPixExpiryFromAcceptance(acceptedAt, Date.parse('2026-11-03T12:20:00.000Z'));
  assert.equal(first, '2026-11-03T12:30:00.000Z');
  assert.equal(retry, first);
  assert.throws(() => prepaidRenewalPixExpiryFromAcceptance(acceptedAt, Date.parse('2026-11-03T12:30:00.000Z')), /RENEWAL_PIX_ACCEPTANCE_WINDOW_EXPIRED/);
  assert.throws(() => prepaidRenewalPixExpiryFromAcceptance(acceptedAt, Date.parse('2026-11-03T11:59:00.000Z')), /RENEWAL_PIX_ACCEPTANCE_WINDOW_EXPIRED/);
  assert.throws(() => prepaidRenewalPixExpiryFromAcceptance('invalid'), /RENEWAL_PIX_ACCEPTANCE_TIMESTAMP_INVALID/);
});
