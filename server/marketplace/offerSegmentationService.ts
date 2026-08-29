import { adminDb } from '../firebaseAdmin.js';
import {
  isPaymentAuthoritativelyPaid,
  normalizeCanonicalPayment,
  type CanonicalPayment,
} from '../../src/utils/canonicalPayment.js';
import { listPublicStorePromotions } from '../payments/storePromotionService.js';

export const MARKETPLACE_OFFER_SEGMENT_MAX_STORES = 100 as const;

export interface MarketplaceOfferSegments {
  promotionStoreIds: string[];
  forYouStoreIds: string[];
}

const clean = (value: unknown): string =>
  typeof value === 'string' ? value.trim() : '';

export const normalizeMarketplaceSegmentStoreIds = (
  value: unknown
): string[] => {
  if (!Array.isArray(value)) {
    throw new Error('MARKETPLACE_SEGMENT_STORE_IDS_REQUIRED');
  }
  const normalized = Array.from(new Set(value.map(clean).filter(Boolean)));
  if (normalized.length === 0) {
    throw new Error('MARKETPLACE_SEGMENT_STORE_IDS_REQUIRED');
  }
  if (normalized.length > MARKETPLACE_OFFER_SEGMENT_MAX_STORES) {
    throw new Error('MARKETPLACE_SEGMENT_STORE_IDS_LIMIT');
  }
  return normalized;
};

const hasAuthoritativePurchase = async (
  storeId: string,
  customerId: string
): Promise<boolean> => {
  const snapshot = await adminDb
    .collection(`stores/${storeId}/payments`)
    .where('buyerId', '==', customerId)
    .get();

  return snapshot.docs.some(document => {
    try {
      const payment = normalizeCanonicalPayment(
        document.data() as CanonicalPayment
      );
      return payment.storeId === storeId &&
        payment.buyerId === customerId &&
        isPaymentAuthoritativelyPaid(payment.status);
    } catch {
      return false;
    }
  });
};

export const deriveMarketplaceOfferSegments = async (input: {
  storeIds: unknown;
  customerId: string;
  now?: Date;
}): Promise<MarketplaceOfferSegments> => {
  const storeIds = normalizeMarketplaceSegmentStoreIds(input.storeIds);
  const customerId = clean(input.customerId);
  if (!customerId) throw new Error('MARKETPLACE_SEGMENT_CUSTOMER_REQUIRED');
  const now = input.now ?? new Date();
  if (Number.isNaN(now.getTime())) {
    throw new Error('MARKETPLACE_SEGMENT_NOW_INVALID');
  }

  const segments = await Promise.all(
    storeIds.map(async storeId => {
      const [promotions, hasPurchase] = await Promise.all([
        listPublicStorePromotions(storeId, now),
        hasAuthoritativePurchase(storeId, customerId),
      ]);
      return {
        storeId,
        hasPromotion: promotions.length > 0,
        forYou: hasPurchase,
      };
    })
  );

  return {
    promotionStoreIds: segments
      .filter(segment => segment.hasPromotion)
      .map(segment => segment.storeId),
    forYouStoreIds: segments
      .filter(segment => segment.forYou)
      .map(segment => segment.storeId),
  };
};