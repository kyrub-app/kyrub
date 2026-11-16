import assert from 'node:assert/strict';
import { test } from 'node:test';
import { buildOfficialPromotionAcceptedTerms } from '../server/payments/officialPlanPromotionAcceptedTerms.js';
import { resolveOfficialPromotionalCheckoutAmount } from '../server/payments/officialPlanPromotionCheckoutAmount.js';
import { verifyIsolatedOfficialPlanPromotionPix } from '../server/payments/officialPlanPromotionSimulatedPix.js';
import type { StorePromotion } from '../src/utils/storePromotions.js';

const promotion: StorePromotion = {
  id: 'erp-business-one-real', storeId: 'official', code: 'BUSINESS-UM-REAL',
  title: 'Business piloto', badge: 'PILOTO', discountType: 'fixed',
  discountValue: 396, productIds: ['business'],
  eligibility: { mode: 'public' }, active: true,
  startsAt: '2026-01-01T00:00:00.000Z', endsAt: '2027-01-01T00:00:00.000Z',
  maxRedemptions: 1, maxRedemptionsPerBuyer: 1, redemptionCount: 0,
  createdBy: 'official-owner', createdVia: 'manual', actionId: 'pilot',
  createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z',
};
const checkoutId = 'b'.repeat(64);
const buyerUid = 'third-fictitious-user';
const offer = { storeId: 'official', productId: 'business',
  quote: { months: 1 as const, totalMinor: 39700 } };

test('isolated commercial chain: ERP coupon -> accepted R$1 -> approved simulated Pix', () => {
  const previousHost = process.env.FIRESTORE_EMULATOR_HOST;
  const previousFlag = process.env.KYRUB_OFFICIAL_PROMOTION_ISOLATED_PIX_TEST;
  try {
    process.env.FIRESTORE_EMULATOR_HOST = '127.0.0.1:8080';
    process.env.KYRUB_OFFICIAL_PROMOTION_ISOLATED_PIX_TEST = 'true';
    const accepted = buildOfficialPromotionAcceptedTerms({
      promotion, officialStoreId: offer.storeId, officialProductId: offer.productId,
      buyerUid, months: 1, contractTotalMinor: offer.quote.totalMinor,
      now: new Date('2026-11-15T12:00:00.000Z'),
    });
    const quote = resolveOfficialPromotionalCheckoutAmount({
      buyerUid, offer, accepted, providerAmountMinor: 100,
    });
    assert.deepEqual([quote.originalTotalMinor, quote.discountMinor, quote.payableMinor],
      [39700, 39600, 100]);
    const confirmation = {
      paymentId: 'simulated-business-pix', checkoutId, buyerUid,
      amountMinor: 100, currency: 'BRL' as const,
      method: 'pix' as const, status: 'approved' as const,
    };
    const result = verifyIsolatedOfficialPlanPromotionPix({
      checkoutId, buyerUid, offer, accepted, confirmation,
    });
    assert.equal(result.paidMinor, 100);
    assert.equal(result.acceptedTermsDigest, accepted.termsDigest);
    assert.equal(result.simulated, true);
    assert.throws(() => verifyIsolatedOfficialPlanPromotionPix({
      checkoutId, buyerUid, offer, accepted,
      confirmation: { ...confirmation, amountMinor: 39700 },
    }), /MISMATCH/);
  } finally {
    if (previousHost === undefined) delete process.env.FIRESTORE_EMULATOR_HOST;
    else process.env.FIRESTORE_EMULATOR_HOST = previousHost;
    if (previousFlag === undefined) delete process.env.KYRUB_OFFICIAL_PROMOTION_ISOLATED_PIX_TEST;
    else process.env.KYRUB_OFFICIAL_PROMOTION_ISOLATED_PIX_TEST = previousFlag;
  }
});
