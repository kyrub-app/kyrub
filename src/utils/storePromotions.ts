export type StorePromotionDiscountType = 'percentage' | 'fixed';
export type StorePromotionEligibilityMode =
  | 'public'
  | 'club_member'
  | 'crm_segment'
  | 'specific_user';

export interface StorePromotionEligibility {
  mode: StorePromotionEligibilityMode;
  segmentId?: string;
  userIds?: string[];
}

export interface StorePromotion {
  id: string;
  storeId: string;
  code: string;
  title: string;
  badge: string;
  discountType: StorePromotionDiscountType;
  discountValue: number;
  productIds: string[];
  eligibility: StorePromotionEligibility;
  active: boolean;
  startsAt: string;
  endsAt: string;
  maxRedemptions: number;
  maxRedemptionsPerBuyer: number;
  redemptionCount: number;
  createdBy: string;
  createdVia: 'manual' | 'kyrubia' | 'api';
  actionId: string;
  createdAt: string;
  updatedAt: string;
}

export interface PromotionCartLine {
  productId: string;
  unitPrice: number;
  quantity: number;
}

export interface StorePromotionQuote {
  promotionId: string;
  code: string;
  title: string;
  badge: string;
  discountType: StorePromotionDiscountType;
  discountValue: number;
  eligibleProductIds: string[];
  eligibleSubtotal: number;
  subtotal: number;
  discountTotal: number;
  total: number;
}

const clean = (value: unknown): string =>
  typeof value === 'string' ? value.trim() : '';

export const normalizePromotionCode = (value: unknown): string =>
  clean(value)
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toUpperCase()
    .replace(/[^A-Z0-9_-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 48);

const money = (value: number): number => {
  if (!Number.isFinite(value) || value < 0) {
    throw new Error('PROMOTION_MONEY_INVALID');
  }
  return Math.round(value * 100) / 100;
};

const uniqueIds = (values: unknown): string[] =>
  Array.isArray(values)
    ? Array.from(new Set(values.map(clean).filter(Boolean)))
    : [];

const validIso = (value: string): boolean =>
  Boolean(value) && !Number.isNaN(Date.parse(value));

export const normalizeStorePromotion = (
  value: StorePromotion
): StorePromotion => {
  const id = clean(value.id);
  const storeId = clean(value.storeId);
  const code = normalizePromotionCode(value.code);
  const title = clean(value.title);
  const productIds = uniqueIds(value.productIds);
  if (!id || !storeId || !code || !title) throw new Error('PROMOTION_REQUIRED_FIELDS');
  if (!productIds.length) throw new Error('PROMOTION_PRODUCTS_REQUIRED');
  if (value.discountType !== 'percentage' && value.discountType !== 'fixed') {
    throw new Error('PROMOTION_DISCOUNT_TYPE_INVALID');
  }
  if (!Number.isFinite(value.discountValue) || value.discountValue <= 0) {
    throw new Error('PROMOTION_DISCOUNT_VALUE_INVALID');
  }
  if (value.discountType === 'percentage' && value.discountValue > 100) {
    throw new Error('PROMOTION_PERCENTAGE_INVALID');
  }
  if (!validIso(value.startsAt) || !validIso(value.endsAt)) {
    throw new Error('PROMOTION_WINDOW_INVALID');
  }
  if (Date.parse(value.endsAt) <= Date.parse(value.startsAt)) {
    throw new Error('PROMOTION_WINDOW_INVALID');
  }
  if (!Number.isInteger(value.maxRedemptions) || value.maxRedemptions < 0) {
    throw new Error('PROMOTION_LIMIT_INVALID');
  }
  if (!Number.isInteger(value.maxRedemptionsPerBuyer) || value.maxRedemptionsPerBuyer < 0) {
    throw new Error('PROMOTION_BUYER_LIMIT_INVALID');
  }
  if (!Number.isInteger(value.redemptionCount) || value.redemptionCount < 0) {
    throw new Error('PROMOTION_REDEMPTION_COUNT_INVALID');
  }

  const eligibility = value.eligibility ?? { mode: 'public' as const };
  if (!['public', 'club_member', 'crm_segment', 'specific_user'].includes(eligibility.mode)) {
    throw new Error('PROMOTION_ELIGIBILITY_INVALID');
  }
  const segmentId = clean(eligibility.segmentId);
  const userIds = uniqueIds(eligibility.userIds);
  if (eligibility.mode === 'crm_segment' && !segmentId) {
    throw new Error('PROMOTION_SEGMENT_REQUIRED');
  }
  if (eligibility.mode === 'specific_user' && !userIds.length) {
    throw new Error('PROMOTION_USERS_REQUIRED');
  }

  return {
    ...value,
    id,
    storeId,
    code,
    title,
    badge: clean(value.badge) || (
      value.discountType === 'percentage'
        ? `${value.discountValue}% OFF`
        : 'CUPOM'
    ),
    discountValue:
      value.discountType === 'fixed' ? money(value.discountValue) : value.discountValue,
    productIds,
    eligibility: {
      mode: eligibility.mode,
      ...(segmentId ? { segmentId } : {}),
      ...(userIds.length ? { userIds } : {}),
    },
    startsAt: new Date(value.startsAt).toISOString(),
    endsAt: new Date(value.endsAt).toISOString(),
    createdBy: clean(value.createdBy),
    createdVia: value.createdVia,
    actionId: clean(value.actionId),
    createdAt: clean(value.createdAt),
    updatedAt: clean(value.updatedAt),
  };
};

export const isPromotionCurrentlyAvailable = (
  promotionInput: StorePromotion,
  now = new Date()
): boolean => {
  const promotion = normalizeStorePromotion(promotionInput);
  const timestamp = now.getTime();
  if (!promotion.active || Number.isNaN(timestamp)) return false;
  if (timestamp < Date.parse(promotion.startsAt) || timestamp >= Date.parse(promotion.endsAt)) {
    return false;
  }
  return promotion.maxRedemptions === 0 || promotion.redemptionCount < promotion.maxRedemptions;
};

export const isPromotionEligibleForBuyer = (
  promotionInput: StorePromotion,
  buyerId: string,
  options: { clubMember?: boolean; crmSegmentIds?: string[] } = {}
): boolean => {
  const promotion = normalizeStorePromotion(promotionInput);
  const normalizedBuyerId = clean(buyerId);
  switch (promotion.eligibility.mode) {
    case 'public':
      return true;
    case 'club_member':
      return options.clubMember === true;
    case 'crm_segment':
      return Boolean(
        promotion.eligibility.segmentId &&
        options.crmSegmentIds?.includes(promotion.eligibility.segmentId)
      );
    case 'specific_user':
      return Boolean(normalizedBuyerId && promotion.eligibility.userIds?.includes(normalizedBuyerId));
  }
};

export const quoteStorePromotion = (
  promotionInput: StorePromotion,
  linesInput: PromotionCartLine[]
): StorePromotionQuote => {
  const promotion = normalizeStorePromotion(promotionInput);
  const productSet = new Set(promotion.productIds);
  const lines = linesInput.map(line => {
    if (!clean(line.productId) || !Number.isInteger(line.quantity) || line.quantity <= 0) {
      throw new Error('PROMOTION_CART_LINE_INVALID');
    }
    return {
      productId: clean(line.productId),
      quantity: line.quantity,
      unitPrice: money(line.unitPrice),
    };
  });
  const subtotalCents = lines.reduce(
    (sum, line) => sum + Math.round(line.unitPrice * 100) * line.quantity,
    0
  );
  const eligibleLines = lines.filter(line => productSet.has(line.productId));
  const eligibleSubtotalCents = eligibleLines.reduce(
    (sum, line) => sum + Math.round(line.unitPrice * 100) * line.quantity,
    0
  );
  if (eligibleSubtotalCents <= 0) throw new Error('PROMOTION_NOT_APPLICABLE');

  const rawDiscountCents = promotion.discountType === 'percentage'
    ? Math.round(eligibleSubtotalCents * promotion.discountValue / 100)
    : Math.round(promotion.discountValue * 100);
  const discountCents = Math.min(eligibleSubtotalCents, rawDiscountCents);
  const totalCents = subtotalCents - discountCents;

  return {
    promotionId: promotion.id,
    code: promotion.code,
    title: promotion.title,
    badge: promotion.badge,
    discountType: promotion.discountType,
    discountValue: promotion.discountValue,
    eligibleProductIds: eligibleLines.map(line => line.productId),
    eligibleSubtotal: eligibleSubtotalCents / 100,
    subtotal: subtotalCents / 100,
    discountTotal: discountCents / 100,
    total: totalCents / 100,
  };
};