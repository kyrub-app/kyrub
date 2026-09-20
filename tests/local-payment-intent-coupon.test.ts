import assert from 'node:assert/strict';
import test from 'node:test';
import { normalizeCanonicalPaymentIntent, type ExistingOrderPaymentIntentDocument } from '../src/utils/canonicalPaymentIntent.js';
import { quoteStorePromotion, type StorePromotion } from '../src/utils/storePromotions.js';

const fixedPromotion: StorePromotion = {
  id: 'promo-pix-test', storeId: 'store-1', code: 'PIXTESTE', title: 'Cupom teste Pix', badge: 'R$ 29,40 OFF',
  discountType: 'fixed', discountValue: 29.4, productIds: ['product-2950'], eligibility: { mode: 'public' }, active: true,
  startsAt: '2026-09-01T00:00:00.000Z', endsAt: '2026-10-01T00:00:00.000Z', maxRedemptions: 0,
  maxRedemptionsPerBuyer: 1, redemptionCount: 0, createdBy: 'owner-1', createdVia: 'manual', actionId: '',
  createdAt: '2026-09-01T00:00:00.000Z', updatedAt: '2026-09-01T00:00:00.000Z',
};

const intent = (overrides: Partial<ExistingOrderPaymentIntentDocument> = {}): ExistingOrderPaymentIntentDocument => ({
  id: 'pi-local-test', storeId: 'store-1', buyerId: 'buyer-1', method: 'pix', status: 'pending', amount: 0.1,
  currency: 'BRL', provider: '', providerIntentId: '', idempotencyKey: 'idem-1', context: 'table',
  target: { kind: 'existing_order', orderId: 'order-1' },
  commercialSnapshot: {
    subtotal: 29.5, discountTotal: 29.4, total: 0.1, couponCode: 'PIXTESTE',
    promotionSnapshot: { promotionId: fixedPromotion.id, code: fixedPromotion.code, title: fixedPromotion.title, badge: fixedPromotion.badge,
      discountType: fixedPromotion.discountType, discountValue: fixedPromotion.discountValue, eligibleProductIds: [...fixedPromotion.productIds] },
  },
  createdAt: '2026-09-20T12:00:00.000Z', updatedAt: '2026-09-20T12:00:00.000Z', expiresAt: '2026-09-20T12:15:00.000Z',
  ...overrides,
});

test('fixed coupon reduces R$ 29,50 to exactly R$ 0,10', () => {
  const quote = quoteStorePromotion(fixedPromotion, [{ productId: 'product-2950', unitPrice: 29.5, quantity: 1 }]);
  assert.equal(quote.subtotal, 29.5);
  assert.equal(quote.discountTotal, 29.4);
  assert.equal(quote.total, 0.1);
});

test('local Pix intent freezes subtotal, discount, coupon and promotion at R$ 0,10', () => {
  const normalized = normalizeCanonicalPaymentIntent(intent());
  assert.equal(normalized.amount, 0.1);
  assert.deepEqual(normalized.commercialSnapshot, intent().commercialSnapshot);
});

test('rejects a Pix amount that differs from immutable commercial total', () => {
  assert.throws(() => normalizeCanonicalPaymentIntent(intent({ amount: 29.5 })), /amount must equal the immutable commercial total/i);
});

test('rejects discounted local intent without coupon/promotion snapshot', () => {
  assert.throws(() => normalizeCanonicalPaymentIntent(intent({ commercialSnapshot: { subtotal: 29.5, discountTotal: 29.4, total: 0.1, couponCode: '', promotionSnapshot: null } })), /requires an immutable promotion snapshot/i);
});

test('rejects commercial arithmetic inconsistent with subtotal minus discount', () => {
  assert.throws(() => normalizeCanonicalPaymentIntent(intent({ commercialSnapshot: { ...intent().commercialSnapshot!, total: 0.2 } })), /total does not match subtotal - discount/i);
});
