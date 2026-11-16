import assert from 'node:assert/strict';
import { test } from 'node:test';
import { buildOfficialPromotionAcceptedTerms } from '../server/payments/officialPlanPromotionAcceptedTerms.js';
import { resolveOfficialPromotionalCheckoutAmount } from '../server/payments/officialPlanPromotionCheckoutAmount.js';
import type { StorePromotion } from '../src/utils/storePromotions.js';

const promotion: StorePromotion = {
  id: 'erp-coupon', storeId: 'official', code: 'BUSINESS-1-REAL',
  title: 'Business piloto', badge: 'PILOTO', discountType: 'fixed',
  discountValue: 396, productIds: ['business'],
  eligibility: { mode: 'public' }, active: true,
  startsAt: '2026-01-01T00:00:00.000Z', endsAt: '2027-01-01T00:00:00.000Z',
  maxRedemptions: 1, maxRedemptionsPerBuyer: 1, redemptionCount: 0,
  createdBy: 'owner', createdVia: 'manual', actionId: 'pilot',
  createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z',
};
const accepted = buildOfficialPromotionAcceptedTerms({
  promotion, officialStoreId: 'official', officialProductId: 'business',
  buyerUid: 'third-user', months: 1, contractTotalMinor: 39700,
  now: new Date('2026-11-15T12:00:00Z'),
});
const input = {
  buyerUid: 'third-user',
  offer: { storeId: 'official', productId: 'business',
    quote: { months: 1 as const, totalMinor: 39700 } },
  accepted,
};
test('Business canonical R$397 and ERP discount R$396 yields exactly R$1', () => {
  const result = resolveOfficialPromotionalCheckoutAmount({ ...input, providerAmountMinor: 100 });
  assert.equal(result.originalTotalMinor, 39700);
  assert.equal(result.discountMinor, 39600);
  assert.equal(result.payableMinor, 100);
});
test('fails closed for wrong buyer, product, months, base price or provider amount', () => {
  const bad = [
    { ...input, buyerUid: 'other' },
    { ...input, offer: { ...input.offer, productId: 'pro' } },
    { ...input, offer: { ...input.offer, quote: { months: 3 as const, totalMinor: 39700 } } },
    { ...input, offer: { ...input.offer, quote: { months: 1 as const, totalMinor: 19700 } } },
    { ...input, providerAmountMinor: 39700 },
    { ...input, providerAmountMinor: 99 },
    { ...input, accepted: { ...accepted, discountMinor: 39500 } },
  ];
  for (const candidate of bad) {
    assert.throws(() => resolveOfficialPromotionalCheckoutAmount(candidate), /MISMATCH/);
  }
});
