import assert from 'node:assert/strict';
import { test } from 'node:test';
import { assertOfficialPromotionPaymentMatches, buildOfficialPromotionAcceptedTerms } from '../server/payments/officialPlanPromotionAcceptedTerms.js';
import type { StorePromotion } from '../src/utils/storePromotions.js';

const promotion: StorePromotion = {
  id: 'pilot', storeId: 'official', code: 'BUSINESS-PILOT',
  title: 'Piloto Business', badge: 'PILOTO', discountType: 'fixed',
  discountValue: 396, productIds: ['business'],
  eligibility: { mode: 'public' }, active: true,
  startsAt: '2026-01-01T00:00:00.000Z', endsAt: '2027-01-01T00:00:00.000Z',
  maxRedemptions: 1, maxRedemptionsPerBuyer: 1, redemptionCount: 0,
  createdBy: 'owner', createdVia: 'manual', actionId: 'pilot',
  createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z',
};
const input = { promotion, officialStoreId: 'official', officialProductId: 'business',
  buyerUid: 'third-test-user', months: 1 as const, contractTotalMinor: 39700,
  now: new Date('2026-11-15T12:00:00.000Z') };

test('binds R$1 Business quote to one buyer, product and term', () => {
  const accepted = buildOfficialPromotionAcceptedTerms(input);
  assert.equal(accepted.payableMinor, 100);
  assert.equal(accepted.originalTotalMinor, 39700);
  assert.equal(accepted.termsDigest.length, 64);
  assert.equal(buildOfficialPromotionAcceptedTerms(input).termsDigest, accepted.termsDigest);
  assertOfficialPromotionPaymentMatches(accepted, {
    buyerUid: accepted.buyerUid, officialStoreId: accepted.officialStoreId,
    officialProductId: accepted.officialProductId, months: accepted.months,
    paidMinor: 100, termsDigest: accepted.termsDigest,
  });
});
test('rejects provider amount mismatch and identity or term substitution', () => {
  const accepted = buildOfficialPromotionAcceptedTerms(input);
  const payment = { buyerUid: accepted.buyerUid, officialStoreId: accepted.officialStoreId,
    officialProductId: accepted.officialProductId, months: accepted.months,
    paidMinor: 100, termsDigest: accepted.termsDigest };
  for (const change of [
    { paidMinor: 39700 }, { paidMinor: 99 }, { buyerUid: 'another' },
    { officialStoreId: 'other' }, { officialProductId: 'pro' },
    { months: 3 as const }, { termsDigest: '0'.repeat(64) },
  ]) {
    assert.throws(() => assertOfficialPromotionPaymentMatches(accepted, { ...payment, ...change }), /PAYMENT_MISMATCH/);
  }
});
test('rejects a mutated accepted snapshot', () => {
  const accepted = buildOfficialPromotionAcceptedTerms(input);
  const forged = { ...accepted, payableMinor: 1 };
  assert.throws(() => assertOfficialPromotionPaymentMatches(forged, {
    buyerUid: forged.buyerUid, officialStoreId: forged.officialStoreId,
    officialProductId: forged.officialProductId, months: forged.months,
    paidMinor: 1, termsDigest: forged.termsDigest,
  }), /PAYMENT_MISMATCH/);
});
