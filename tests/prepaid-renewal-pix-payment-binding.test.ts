import assert from 'node:assert/strict';
import { test } from 'node:test';
import { assertVerifiedPrepaidRenewalPixAttempt } from '../server/payments/prepaidRenewalPixPaymentBinding.js';

const proposalId = 'a'.repeat(64);
const acceptedAt = '2026-11-03T12:00:00.000Z';
const expiresAt = '2026-11-03T12:30:00.000Z';
const valid = () => ({
  storeId: 'store-a', proposalId, acceptedAt, acceptedTotalMinor: 29990,
  paymentId: '123456', paymentApprovedAt: '2026-11-03T12:10:00.000Z',
  verifiedPaymentAmountMinor: 29990,
  attempt: {
    storeId: 'store-a', proposalId, status: 'reserved' as const,
    idempotencyKey: `prepaid-renewal-${proposalId}`,
    requestDigest: 'b'.repeat(64), expiresAt,
  },
});
test('matching reserved Pix attempt and verified amount are accepted', () => {
  assert.doesNotThrow(() => assertVerifiedPrepaidRenewalPixAttempt(valid()));
});
test('missing reservation or wrong store, proposal, amount, expiry rejects', () => {
  for (const change of [
    { attempt: null },
    { storeId: 'store-b' },
    { proposalId: 'c'.repeat(64) },
    { verifiedPaymentAmountMinor: 29989 },
    { attempt: { ...valid().attempt, expiresAt: '2026-11-03T12:31:00.000Z' } },
    { paymentApprovedAt: '2026-11-03T11:59:00.000Z' },
    { paymentId: 'not-a-provider-id' },
  ]) {
    assert.throws(() => assertVerifiedPrepaidRenewalPixAttempt({
      ...valid(), ...change,
    }), /RENEWAL_PIX_PAYMENT_ATTEMPT_MISMATCH/);
  }
});
