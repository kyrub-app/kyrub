import { createHash } from 'node:crypto';
import { adminDb } from '../firebaseAdmin.js';
import { normalizeStorePromotion, type StorePromotion } from '../../src/utils/storePromotions.js';
import { quoteOfficialPlanPromotion } from './officialPlanPromotionQuote.js';

const validId = (value: string) => /^[a-zA-Z0-9_-]{1,128}$/.test(value);
const reservationId = (checkoutId: string) =>
  createHash('sha256').update('official-plan-promotion:' + checkoutId).digest('hex');

/**
 * Transactional, isolated coupon reservation primitive.
 *
 * Not wired to the payment endpoint. Caller must pass a server-authenticated
 * buyer, a canonical store ID and an authoritative contract total.
 * Reservations are counted against redemption limits to prevent overselling.
 * No real provider request is made here.
 */
export async function reserveOfficialPlanPromotionForCheckout(input: {
  checkoutId: string;
  buyerUid: string;
  officialStoreId: string;
  officialProductId: string;
  promotionId: string;
  contractTotalMinor: number;
  now?: Date;
}) {
  if (![input.checkoutId, input.buyerUid, input.officialStoreId,
    input.officialProductId, input.promotionId].every(validId)) {
    throw new Error('OFFICIAL_PROMOTION_INVALID_INPUT');
  }
  const designation = await adminDb.doc('kyrub_admin/official_store').get();
  if (designation.get('canonicalStoreId') !== input.officialStoreId) {
    throw new Error('OFFICIAL_PROMOTION_STORE_FORBIDDEN');
  }
  const promotionRef = adminDb.doc(
    `stores/${input.officialStoreId}/promotions/${input.promotionId}`
  );
  const reservationRef = adminDb.doc(
    `stores/${input.officialStoreId}/promotionReservations/${reservationId(input.checkoutId)}`
  );
  const buyerReservationRef = adminDb.doc(
    `stores/${input.officialStoreId}/promotionBuyerReservations/${input.promotionId}_${createHash('sha256').update(input.buyerUid).digest('hex')}`
  );
  return adminDb.runTransaction(async tx => {
    const [promotionDoc, reservationDoc, buyerDoc] = await Promise.all([
      tx.get(promotionRef), tx.get(reservationRef), tx.get(buyerReservationRef),
    ]);
    if (reservationDoc.exists) {
      const prior = reservationDoc.data()!;
      if (prior.checkoutId !== input.checkoutId || prior.buyerUid !== input.buyerUid ||
          prior.productId !== input.officialProductId || prior.promotionId !== input.promotionId ||
          prior.originalTotalMinor !== input.contractTotalMinor) {
        throw new Error('OFFICIAL_PROMOTION_RESERVATION_CONFLICT');
      }
      return { reservationId: reservationRef.id, payableMinor: prior.payableMinor,
        discountMinor: prior.discountMinor, status: 'already_reserved' as const };
    }
    if (!promotionDoc.exists) throw new Error('OFFICIAL_PROMOTION_NOT_FOUND');
    const promotion = normalizeStorePromotion({
      ...(promotionDoc.data() as StorePromotion),
      id: promotionDoc.id, storeId: input.officialStoreId,
    });
    const quote = quoteOfficialPlanPromotion({ ...input, promotion, now: input.now });
    const buyerCount = Number(buyerDoc.get('reservationCount') ?? 0);
    if (!Number.isSafeInteger(buyerCount) || buyerCount < 0 ||
        (promotion.maxRedemptionsPerBuyer > 0 && buyerCount >= promotion.maxRedemptionsPerBuyer)) {
      throw new Error('OFFICIAL_PROMOTION_BUYER_LIMIT');
    }
    // Counter includes pending reservations, preventing concurrent oversell.
    const reserved = Number(promotionDoc.get('reservedCount') ?? 0);
    if (!Number.isSafeInteger(reserved) || reserved < 0 ||
        (promotion.maxRedemptions > 0 &&
          promotion.redemptionCount + reserved >= promotion.maxRedemptions)) {
      throw new Error('OFFICIAL_PROMOTION_LIMIT');
    }
    tx.create(reservationRef, {
      checkoutId: input.checkoutId, buyerUid: input.buyerUid,
      productId: input.officialProductId, promotionId: input.promotionId,
      originalTotalMinor: quote.originalTotalMinor, discountMinor: quote.discountMinor,
      payableMinor: quote.payableMinor, status: 'reserved',
      reservedAt: (input.now ?? new Date()).toISOString(),
    });
    tx.set(buyerReservationRef, { buyerUid: input.buyerUid, promotionId: input.promotionId,
      reservationCount: buyerCount + 1 }, { merge: true });
    tx.update(promotionRef, { reservedCount: reserved + 1 });
    return { reservationId: reservationRef.id, payableMinor: quote.payableMinor,
      discountMinor: quote.discountMinor, status: 'reserved' as const };
  });
}
