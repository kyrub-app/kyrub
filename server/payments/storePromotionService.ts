import { adminDb } from '../firebaseAdmin.js';
import {
  isPromotionCurrentlyAvailable,
  isPromotionEligibleForBuyer,
  normalizePromotionCode,
  normalizeStorePromotion,
  quoteStorePromotion,
  type PromotionCartLine,
  type StorePromotion,
  type StorePromotionQuote,
} from '../../src/utils/storePromotions.js';

const clean = (value: unknown): string =>
  typeof value === 'string' ? value.trim() : '';

export interface ResolvedStorePromotion {
  promotion: StorePromotion;
  quote: StorePromotionQuote;
}

export interface PublicStorePromotion {
  id: string;
  code: string;
  title: string;
  badge: string;
  discountType: 'percentage' | 'fixed';
  discountValue: number;
  productIds: string[];
  endsAt: string;
}

const promotionCollectionPath = (storeId: string): string =>
  `stores/${storeId}/promotions`;

const redemptionCollectionPath = (storeId: string, promotionId: string): string =>
  `stores/${storeId}/promotions/${promotionId}/redemptions`;

export const getPromotionByCode = async (
  storeIdInput: string,
  codeInput: string
): Promise<StorePromotion | null> => {
  const storeId = clean(storeIdInput);
  const code = normalizePromotionCode(codeInput);
  if (!storeId || !code) return null;

  const snapshot = await adminDb
    .collection(promotionCollectionPath(storeId))
    .where('code', '==', code)
    .limit(2)
    .get();

  if (snapshot.empty) return null;
  if (snapshot.size > 1) throw new Error('PROMOTION_CODE_CONFLICT');
  const document = snapshot.docs[0];
  if (!document) return null;
  return normalizeStorePromotion({
    ...(document.data() as StorePromotion),
    id: document.id,
    storeId,
  });
};

const getBuyerRedemptionCount = async (
  storeId: string,
  promotionId: string,
  buyerId: string
): Promise<number> => {
  if (!buyerId) return 0;
  const snapshot = await adminDb
    .collection(redemptionCollectionPath(storeId, promotionId))
    .where('buyerId', '==', buyerId)
    .get();
  return snapshot.size;
};

export const resolveStorePromotionForCheckout = async (input: {
  storeId: string;
  buyerId: string;
  couponCode: string;
  lines: PromotionCartLine[];
  now?: Date;
}): Promise<ResolvedStorePromotion> => {
  const promotion = await getPromotionByCode(input.storeId, input.couponCode);
  if (!promotion) throw new Error('CHECKOUT_COUPON_NOT_FOUND');
  if (!isPromotionCurrentlyAvailable(promotion, input.now ?? new Date())) {
    throw new Error('CHECKOUT_COUPON_NOT_AVAILABLE');
  }

  // V1 executes public coupons. The same canonical contract already carries the
  // future Club/CRM modes, but those modes stay closed until authoritative
  // membership/segment resolvers are connected.
  if (
    promotion.eligibility.mode !== 'public' ||
    !isPromotionEligibleForBuyer(promotion, input.buyerId)
  ) {
    throw new Error('CHECKOUT_COUPON_NOT_ELIGIBLE');
  }

  if (promotion.maxRedemptionsPerBuyer > 0) {
    const buyerRedemptions = await getBuyerRedemptionCount(
      promotion.storeId,
      promotion.id,
      input.buyerId
    );
    if (buyerRedemptions >= promotion.maxRedemptionsPerBuyer) {
      throw new Error('CHECKOUT_COUPON_BUYER_LIMIT_REACHED');
    }
  }

  return {
    promotion,
    quote: quoteStorePromotion(promotion, input.lines),
  };
};

export const listPublicStorePromotions = async (
  storeIdInput: string,
  now = new Date()
): Promise<PublicStorePromotion[]> => {
  const storeId = clean(storeIdInput);
  if (!storeId) return [];
  const snapshot = await adminDb
    .collection(promotionCollectionPath(storeId))
    .where('active', '==', true)
    .get();

  return snapshot.docs.flatMap(document => {
    try {
      const promotion = normalizeStorePromotion({
        ...(document.data() as StorePromotion),
        id: document.id,
        storeId,
      });
      if (
        promotion.eligibility.mode !== 'public' ||
        !isPromotionCurrentlyAvailable(promotion, now)
      ) {
        return [];
      }
      return [{
        id: promotion.id,
        code: promotion.code,
        title: promotion.title,
        badge: promotion.badge,
        discountType: promotion.discountType,
        discountValue: promotion.discountValue,
        productIds: promotion.productIds,
        endsAt: promotion.endsAt,
      }];
    } catch {
      return [];
    }
  });
};