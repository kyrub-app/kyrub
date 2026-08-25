import assert from 'node:assert/strict';
import test from 'node:test';
import {
  isPromotionCurrentlyAvailable,
  isPromotionEligibleForBuyer,
  normalizePromotionCode,
  normalizeStorePromotion,
  quoteStorePromotion,
  type StorePromotion,
} from '../src/utils/storePromotions.js';

const promotion = (overrides: Partial<StorePromotion> = {}): StorePromotion => ({
  id: 'promo-xburger-95',
  storeId: 'store-1',
  code: 'XBURGER95',
  title: '95% no X-Burger',
  badge: '95% OFF',
  discountType: 'percentage',
  discountValue: 95,
  productIds: ['xburger'],
  eligibility: { mode: 'public' },
  active: true,
  startsAt: '2026-08-25T00:00:00.000Z',
  endsAt: '2026-09-01T00:00:00.000Z',
  maxRedemptions: 0,
  maxRedemptionsPerBuyer: 1,
  redemptionCount: 0,
  createdBy: 'owner-1',
  createdVia: 'kyrubia',
  actionId: 'action-1',
  createdAt: '2026-08-25T00:00:00.000Z',
  updatedAt: '2026-08-25T00:00:00.000Z',
  ...overrides,
});

test('normalizes human coupon codes without preserving accents or spaces', () => {
  assert.equal(normalizePromotionCode('  x-búrguer 95  '), 'X-BURGUER-95');
});

test('quotes 95% off R$ 29,50 as R$ 1,48 using integer-cent rounding', () => {
  const quote = quoteStorePromotion(promotion(), [
    { productId: 'xburger', unitPrice: 29.5, quantity: 1 },
  ]);

  assert.equal(quote.subtotal, 29.5);
  assert.equal(quote.discountTotal, 28.02);
  assert.equal(quote.total, 1.48);
  assert.deepEqual(quote.eligibleProductIds, ['xburger']);
});

test('discount only applies to products explicitly scoped by the promotion', () => {
  const quote = quoteStorePromotion(promotion(), [
    { productId: 'xburger', unitPrice: 29.5, quantity: 1 },
    { productId: 'soda', unitPrice: 10, quantity: 1 },
  ]);

  assert.equal(quote.subtotal, 39.5);
  assert.equal(quote.discountTotal, 28.02);
  assert.equal(quote.total, 11.48);
});

test('refuses a cart with no eligible product instead of silently discounting', () => {
  assert.throws(
    () => quoteStorePromotion(promotion(), [
      { productId: 'soda', unitPrice: 10, quantity: 1 },
    ]),
    /PROMOTION_NOT_APPLICABLE/
  );
});

test('caps fixed discounts at the eligible subtotal', () => {
  const quote = quoteStorePromotion(
    promotion({ discountType: 'fixed', discountValue: 100 }),
    [{ productId: 'xburger', unitPrice: 29.5, quantity: 1 }]
  );

  assert.equal(quote.discountTotal, 29.5);
  assert.equal(quote.total, 0);
});

test('availability respects active window and global redemption limit', () => {
  const now = new Date('2026-08-25T12:00:00.000Z');
  assert.equal(isPromotionCurrentlyAvailable(promotion(), now), true);
  assert.equal(isPromotionCurrentlyAvailable(promotion({ active: false }), now), false);
  assert.equal(
    isPromotionCurrentlyAvailable(promotion({ maxRedemptions: 5, redemptionCount: 5 }), now),
    false
  );
});

test('eligibility contract is ready for public, club, CRM and specific-user modes', () => {
  assert.equal(isPromotionEligibleForBuyer(promotion(), 'buyer-1'), true);
  assert.equal(
    isPromotionEligibleForBuyer(
      promotion({ eligibility: { mode: 'club_member' } }),
      'buyer-1',
      { clubMember: true }
    ),
    true
  );
  assert.equal(
    isPromotionEligibleForBuyer(
      promotion({ eligibility: { mode: 'crm_segment', segmentId: 'inactive-30d' } }),
      'buyer-1',
      { crmSegmentIds: ['inactive-30d'] }
    ),
    true
  );
  assert.equal(
    isPromotionEligibleForBuyer(
      promotion({ eligibility: { mode: 'specific_user', userIds: ['buyer-2'] } }),
      'buyer-1'
    ),
    false
  );
});

test('rejects percentages above 100 instead of creating an invalid promotion', () => {
  assert.throws(
    () => normalizeStorePromotion(promotion({ discountValue: 101 })),
    /PROMOTION_PERCENTAGE_INVALID/
  );
});