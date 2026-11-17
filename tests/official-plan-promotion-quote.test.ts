import assert from 'node:assert/strict';
import { test } from 'node:test';
import { quoteOfficialPlanPromotion } from '../server/payments/officialPlanPromotionQuote.js';
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
const base = { promotion, officialStoreId: 'official', officialProductId: 'business',
  buyerUid: 'third-test-user', contractTotalMinor: 39700, now: new Date('2026-11-15T12:00:00.000Z') };

test('isolated Business R$397 -> R$1 quote, without issuing payment', () => {
  assert.deepEqual(quoteOfficialPlanPromotion(base), {
    promotionId: 'pilot', code: 'BUSINESS-PILOT', originalTotalMinor: 39700,
    discountMinor: 39600, payableMinor: 100,
  });
});
test('rejects another store or product', () => {
  assert.throws(() => quoteOfficialPlanPromotion({ ...base, officialStoreId: 'other' }), /NOT_ELIGIBLE/);
  assert.throws(() => quoteOfficialPlanPromotion({ ...base, officialProductId: 'pro' }), /NOT_ELIGIBLE/);
});
test('rejects expired, inactive, exhausted and noneligible promotions', () => {
  for (const change of [{ active: false }, { redemptionCount: 1 },
    { endsAt: '2026-01-02T00:00:00.000Z' },
    { eligibility: { mode: 'specific_user' as const, userIds: ['someone-else'] } }]) {
    assert.throws(() => quoteOfficialPlanPromotion({ ...base, promotion: { ...promotion, ...change } }), /NOT_ELIGIBLE/);
  }
});
test('rejects zero-value Pix and untrusted malformed totals', () => {
  assert.throws(() => quoteOfficialPlanPromotion({ ...base, promotion: { ...promotion, discountValue: 397 } }), /INVALID_TOTAL/);
  assert.throws(() => quoteOfficialPlanPromotion({ ...base, contractTotalMinor: -1 }), /INVALID_INPUT/);
});

test('percentage discount uses authoritative cents and preserves the plan baseline', () => {
  const result = quoteOfficialPlanPromotion({ ...base,
    promotion: { ...promotion, discountType: 'percentage', discountValue: 50 },
  });
  assert.equal(result.originalTotalMinor, 39700);
  assert.equal(result.discountMinor, 19850);
  assert.equal(result.payableMinor, 19850);
  assert.equal(base.contractTotalMinor, 39700);
});
test('rejects a free 100% coupon, including when the code is otherwise valid', () => {
  assert.throws(() => quoteOfficialPlanPromotion({ ...base,
    promotion: { ...promotion, discountType: 'percentage', discountValue: 100 },
  }), /INVALID_TOTAL/);
});
test('rejects an empty buyer and fractional minor-unit totals', () => {
  assert.throws(() => quoteOfficialPlanPromotion({ ...base, buyerUid: '' }), /INVALID_INPUT/);
  assert.throws(() => quoteOfficialPlanPromotion({ ...base, contractTotalMinor: 39700.5 }), /INVALID_INPUT/);
});
