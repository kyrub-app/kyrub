import assert from 'node:assert/strict';
import { test } from 'node:test';
import { buildOfficialPromotionAcceptedTerms } from '../server/payments/officialPlanPromotionAcceptedTerms.js';
import { verifyIsolatedOfficialPlanPromotionPix } from '../server/payments/officialPlanPromotionSimulatedPix.js';
import type { StorePromotion } from '../src/utils/storePromotions.js';

const promotion: StorePromotion = {
  id: 'pilot', storeId: 'official', code: 'BUSINESS-PILOT',
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
const checkoutId = 'a'.repeat(64);
const input = {
  checkoutId, buyerUid: 'third-user',
  offer: { storeId: 'official', productId: 'business',
    quote: { months: 1 as const, totalMinor: 39700 } },
  accepted,
  confirmation: { paymentId: 'simulated-001', checkoutId, buyerUid: 'third-user',
    amountMinor: 100, currency: 'BRL' as const, method: 'pix' as const, status: 'approved' as const },
};
test('emulator-only simulated Pix approves exact Business R$1 snapshot', () => {
  process.env.FIRESTORE_EMULATOR_HOST = '127.0.0.1:8080';
  process.env.KYRUB_OFFICIAL_PROMOTION_ISOLATED_PIX_TEST = 'true';
  const result = verifyIsolatedOfficialPlanPromotionPix(input);
  assert.equal(result.paidMinor, 100);
  assert.equal(result.simulated, true);
});
test('simulated Pix rejects production, pending, wrong buyer, checkout and amount', () => {
  process.env.FIRESTORE_EMULATOR_HOST = '127.0.0.1:8080';
  process.env.KYRUB_OFFICIAL_PROMOTION_ISOLATED_PIX_TEST = 'true';
  for (const candidate of [
    { ...input, confirmation: { ...input.confirmation, status: 'pending' as const } },
    { ...input, confirmation: { ...input.confirmation, amountMinor: 39700 } },
    { ...input, confirmation: { ...input.confirmation, checkoutId: 'b'.repeat(64) } },
    { ...input, confirmation: { ...input.confirmation, buyerUid: 'another' } },
  ]) {
    assert.throws(() => verifyIsolatedOfficialPlanPromotionPix(candidate), /OFFICIAL_PROMOTION_/);
  }
  delete process.env.FIRESTORE_EMULATOR_HOST;
  assert.throws(() => verifyIsolatedOfficialPlanPromotionPix(input), /EMULATOR_REQUIRED/);
  process.env.FIRESTORE_EMULATOR_HOST = 'firebase.example.com:443';
  assert.throws(() => verifyIsolatedOfficialPlanPromotionPix(input), /EMULATOR_REQUIRED/);
  process.env.FIRESTORE_EMULATOR_HOST = '127.0.0.1:8080';
  delete process.env.KYRUB_OFFICIAL_PROMOTION_ISOLATED_PIX_TEST;
  assert.throws(() => verifyIsolatedOfficialPlanPromotionPix(input), /EMULATOR_REQUIRED/);
});
