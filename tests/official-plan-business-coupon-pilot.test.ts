import assert from 'node:assert/strict';
import test from 'node:test';
import { buildOfficialPromotionAcceptedTerms } from '../server/payments/officialPlanPromotionAcceptedTerms.js';
import {
  assertLiveBusinessCouponPilot, liveBusinessCouponPilotEnabled,
  isPubliclyPresentableBusinessCouponPilot,
} from '../server/payments/officialPlanBusinessCouponPilot.js';
import type { StorePromotion } from '../src/utils/storePromotions.js';

const envKeys = [
  'KYRUB_OFFICIAL_PLAN_PIX_CHECKOUT_ENABLED', 'KYRUB_OFFICIAL_PLAN_PIX_PILOT_MODE',
  'KYRUB_OFFICIAL_PLAN_PIX_PILOT_BUSINESS_COUPON_ENABLED',
  'KYRUB_OFFICIAL_PLAN_PIX_PILOT_BUYER_UID',
  'KYRUB_OFFICIAL_PLAN_PIX_PILOT_PROMOTION_ID',
  'KYRUB_OFFICIAL_PLAN_PIX_PILOT_PROMOTION_CODE',
] as const;
const withPilotEnv = (fn: () => void) => {
  const previous = new Map(envKeys.map(key => [key, process.env[key]]));
  try {
    process.env.KYRUB_OFFICIAL_PLAN_PIX_CHECKOUT_ENABLED = 'true';
    process.env.KYRUB_OFFICIAL_PLAN_PIX_PILOT_MODE = 'true';
    process.env.KYRUB_OFFICIAL_PLAN_PIX_PILOT_BUSINESS_COUPON_ENABLED = 'true';
    process.env.KYRUB_OFFICIAL_PLAN_PIX_PILOT_BUYER_UID = 'buyer-pilot';
    process.env.KYRUB_OFFICIAL_PLAN_PIX_PILOT_PROMOTION_ID = 'biz-pilot';
    process.env.KYRUB_OFFICIAL_PLAN_PIX_PILOT_PROMOTION_CODE = 'PILOT-ONE';
    fn();
  } finally {
    for (const [key, value] of previous) {
      if (value === undefined) delete process.env[key]; else process.env[key] = value;
    }
  }
};

const promotion: StorePromotion = {
  id: 'biz-pilot', storeId: 'official-store', code: 'PILOT-ONE',
  title: 'Business pilot one-time', badge: 'PILOTO', discountType: 'fixed',
  discountValue: 396, productIds: ['business'],
  eligibility: { mode: 'specific_user', userIds: ['buyer-pilot'] },
  active: true, startsAt: '2026-01-01T00:00:00.000Z', endsAt: '2030-01-01T00:00:00.000Z',
  maxRedemptions: 1, maxRedemptionsPerBuyer: 1, redemptionCount: 0,
  createdBy: 'owner', createdVia: 'manual', actionId: 'biz-pilot',
  createdAt: '2026-11-17T00:00:00.000Z', updatedAt: '2026-11-17T00:00:00.000Z',
};
const offer = { storeId: 'official-store', productId: 'business',
  plan: 'business', priceMinor: 39700, quote: { months: 1, totalMinor: 39700 } };
const accepted = buildOfficialPromotionAcceptedTerms({
  promotion, officialStoreId: offer.storeId, officialProductId: offer.productId,
  buyerUid: 'buyer-pilot', months: 1, contractTotalMinor: 39700,
  now: new Date('2026-11-17T12:00:00Z'),
});

test('Business R$1 coupon is an ERP discount only, not a product price override', () => withPilotEnv(() => {
  assert.equal(liveBusinessCouponPilotEnabled(), true);
  assert.equal(offer.priceMinor, 39700);
  assert.equal(accepted.originalTotalMinor, 39700);
  assert.equal(accepted.discountMinor, 39600);
  assert.equal(accepted.payableMinor, 100);
  assert.doesNotThrow(() => assertLiveBusinessCouponPilot({
    buyerUid: 'buyer-pilot', offer, accepted, promotion,
  }));
}));

test('discounted real checkout is denied without an explicit pilot switch, buyer, or coupon binding', () => withPilotEnv(() => {
  const params = { buyerUid: 'buyer-pilot', offer, accepted, promotion };
  const deny = () => assert.throws(() => assertLiveBusinessCouponPilot(params), /PILOT_FORBIDDEN/);
  process.env.KYRUB_OFFICIAL_PLAN_PIX_PILOT_BUSINESS_COUPON_ENABLED = 'false'; deny();
  process.env.KYRUB_OFFICIAL_PLAN_PIX_PILOT_BUSINESS_COUPON_ENABLED = 'true';
  process.env.KYRUB_OFFICIAL_PLAN_PIX_CHECKOUT_ENABLED = 'false'; deny();
  process.env.KYRUB_OFFICIAL_PLAN_PIX_CHECKOUT_ENABLED = 'true';
  process.env.KYRUB_OFFICIAL_PLAN_PIX_PILOT_MODE = 'false'; deny();
  process.env.KYRUB_OFFICIAL_PLAN_PIX_PILOT_MODE = 'true';
  assert.throws(() => assertLiveBusinessCouponPilot({ ...params, buyerUid: 'different-buyer' }), /PILOT_FORBIDDEN/);
  process.env.KYRUB_OFFICIAL_PLAN_PIX_PILOT_PROMOTION_CODE = 'DIFFERENT'; deny();
  process.env.KYRUB_OFFICIAL_PLAN_PIX_PILOT_PROMOTION_CODE = 'PILOT-ONE';
  process.env.KYRUB_OFFICIAL_PLAN_PIX_PILOT_PROMOTION_ID = ''; deny();
}));

test('pilot refuses Pro, longer term, another amount, a public coupon or multiple redemptions', () => withPilotEnv(() => {
  const params = { buyerUid: 'buyer-pilot', offer, accepted, promotion };
  for (const change of [
    { plan: 'pro' }, { quote: { months: 3, totalMinor: 39700 } },
    { priceMinor: 39600 }, { quote: { months: 1, totalMinor: 39600 } },
    { productId: 'other-product' },
  ]) assert.throws(() => assertLiveBusinessCouponPilot({ ...params, offer: { ...offer, ...change } }), /PILOT_FORBIDDEN/);
  for (const change of [
    { payableMinor: 101 }, { payableMinor: 0 }, { originalTotalMinor: 100 },
    { discountMinor: 39500 }, { code: 'WRONG' }, { buyerUid: 'stranger' },
  ]) assert.throws(() => assertLiveBusinessCouponPilot({ ...params, accepted: { ...accepted, ...change } }), /PILOT_FORBIDDEN/);
  for (const change of [
    { eligibility: { mode: 'public' as const } },
    { eligibility: { mode: 'specific_user' as const, userIds: ['buyer-pilot', 'other'] } },
    { maxRedemptions: 2 }, { maxRedemptionsPerBuyer: 0 },
    { redemptionCount: 1 }, { discountValue: 395 }, { active: false },
    { productIds: ['business', 'pro'] },
  ]) assert.throws(() => assertLiveBusinessCouponPilot({ ...params, promotion: { ...promotion, ...change } }), /PILOT_FORBIDDEN/);
}));

test('a buyer-specific pilot may be displayed in the public Praça without disclosing or authorizing buyer identity', () => withPilotEnv(() => {
  const publicPromotion = {
    ...promotion,
    storeId: 'store-ae53dc42e57eb9d5c3f7151c1431',
    productIds: ['draft_5f46706373714839a55846e6d8cb102c'],
  };
  assert.equal(isPubliclyPresentableBusinessCouponPilot(publicPromotion), true);
  assert.equal(isPubliclyPresentableBusinessCouponPilot({
    ...publicPromotion, eligibility: { mode: 'public' },
  }), false);
  assert.equal(isPubliclyPresentableBusinessCouponPilot({
    ...publicPromotion, eligibility: { mode: 'specific_user', userIds: ['buyer-pilot','other'] },
  }), false);
  assert.equal(isPubliclyPresentableBusinessCouponPilot({ ...publicPromotion, storeId: 'other' }), false);
  process.env.KYRUB_OFFICIAL_PLAN_PIX_PILOT_BUSINESS_COUPON_ENABLED = 'false';
  assert.equal(isPubliclyPresentableBusinessCouponPilot(publicPromotion), false);
}));
