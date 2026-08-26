import type {
  StorePromotionDiscountType,
  StorePromotionEligibilityMode,
} from '../src/utils/storePromotions';

export const CREATE_STORE_PROMOTION_ACTION_TYPE = 'create_store_promotion' as const;

export type CreateStorePromotionProposal = {
  id: string;
  type: typeof CREATE_STORE_PROMOTION_ACTION_TYPE;
  storeId: string;
  productIds: string[];
  productLabel: string;
  code: string;
  title: string;
  badge: string;
  discountType: StorePromotionDiscountType;
  discountValue: number;
  eligibilityMode: StorePromotionEligibilityMode;
  startsAt: string;
  endsAt: string;
  maxRedemptions: number;
  maxRedemptionsPerBuyer: number;
  requiresConfirmation: true;
  origin?: 'kyrubia' | 'chatgpt' | 'manual' | 'automation';
  idempotencyKey?: string;
};

const clean = (value: unknown): string =>
  typeof value === 'string' ? value.trim() : '';

const uniqueIds = (value: unknown): string[] =>
  Array.isArray(value)
    ? Array.from(new Set(value.map(clean).filter(Boolean)))
    : [];

const normalizeCode = (value: unknown): string =>
  clean(value)
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toUpperCase()
    .replace(/[^A-Z0-9_-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 48);

const slugCode = (label: string, percentage?: number): string => {
  const product = normalizeCode(label).replace(/-/g, '').slice(0, 18) || 'OFERTA';
  const suffix = typeof percentage === 'number' && Number.isFinite(percentage)
    ? String(Math.round(percentage * 100) / 100).replace(/\D/g, '')
    : 'CUPOM';
  return `${product}${suffix}`.slice(0, 48);
};

const isoOr = (value: unknown, fallback: Date): string => {
  const candidate = clean(value);
  const timestamp = candidate ? Date.parse(candidate) : Number.NaN;
  return Number.isFinite(timestamp)
    ? new Date(timestamp).toISOString()
    : fallback.toISOString();
};

export const normalizeCreateStorePromotionProposal = (
  value: Partial<CreateStorePromotionProposal> & Record<string, unknown>,
  now = new Date()
): CreateStorePromotionProposal => {
  const storeId = clean(value.storeId);
  const productIds = uniqueIds(value.productIds);
  const productLabel = clean(value.productLabel) || 'produto selecionado';
  const discountType: StorePromotionDiscountType =
    value.discountType === 'fixed' ? 'fixed' : 'percentage';
  const discountValue = Number(value.discountValue);

  if (!storeId) throw new Error('PROMOTION_STORE_REQUIRED');
  if (!productIds.length) throw new Error('PROMOTION_PRODUCTS_REQUIRED');
  if (!Number.isFinite(discountValue) || discountValue <= 0) {
    throw new Error('PROMOTION_DISCOUNT_INVALID');
  }
  if (discountType === 'percentage' && discountValue >= 100) {
    // Checkout Pix V1 intentionally keeps a positive payable amount. A future
    // 100% benefit can use a zero-value order path instead of pretending to be Pix.
    throw new Error('PROMOTION_PERCENTAGE_MUST_BE_BELOW_100');
  }

  const startsAt = isoOr(value.startsAt, now);
  const defaultEnd = new Date(Date.parse(startsAt) + 24 * 60 * 60 * 1000);
  const endsAt = isoOr(value.endsAt, defaultEnd);
  if (Date.parse(endsAt) <= Date.parse(startsAt)) {
    throw new Error('PROMOTION_WINDOW_INVALID');
  }

  const maxRedemptions = Number.isInteger(value.maxRedemptions)
    ? Number(value.maxRedemptions)
    : 0;
  const maxRedemptionsPerBuyer = Number.isInteger(value.maxRedemptionsPerBuyer)
    ? Number(value.maxRedemptionsPerBuyer)
    : 1;
  if (maxRedemptions < 0 || maxRedemptionsPerBuyer < 0) {
    throw new Error('PROMOTION_LIMIT_INVALID');
  }

  const eligibilityMode: StorePromotionEligibilityMode = [
    'public',
    'club_member',
    'crm_segment',
    'specific_user',
  ].includes(String(value.eligibilityMode))
    ? value.eligibilityMode as StorePromotionEligibilityMode
    : 'public';

  const code = normalizeCode(value.code) ||
    slugCode(productLabel, discountType === 'percentage' ? discountValue : undefined);
  const badge = clean(value.badge) ||
    (discountType === 'percentage' ? `${discountValue}% OFF` : 'CUPOM');

  return {
    id: clean(value.id) || `promotion:${storeId}:${code}`,
    type: CREATE_STORE_PROMOTION_ACTION_TYPE,
    storeId,
    productIds,
    productLabel,
    code,
    title: clean(value.title) || `${badge} em ${productLabel}`,
    badge,
    discountType,
    discountValue,
    eligibilityMode,
    startsAt,
    endsAt,
    maxRedemptions,
    maxRedemptionsPerBuyer,
    requiresConfirmation: true,
    origin: value.origin ?? 'kyrubia',
    idempotencyKey: clean(value.idempotencyKey) || `promotion:${storeId}:${code}:${startsAt}`,
  };
};
