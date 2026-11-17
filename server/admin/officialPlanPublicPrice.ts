import { OFFICIAL_STORE_CANONICAL_ID, OFFICIAL_PLAN_PRO_PRODUCT_ID, OFFICIAL_PLAN_BUSINESS_PRODUCT_ID } from '../../shared/officialPlanCanonicalDisplay.js';
import { parseProductSaleModality } from '../../shared/productSaleModality.js';

const row = (value: unknown): Record<string, unknown> =>
  value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown> : {};

/** Read-only published-price projection, never used to authorize a payment. */
export const selectPublishedOfficialPlanPrice = (input: {
  planId: 'pro' | 'business';
  designation: unknown;
  product: unknown;
  mapping: unknown;
}): number | null => {
  const expectedId = input.planId === 'pro' ? OFFICIAL_PLAN_PRO_PRODUCT_ID : OFFICIAL_PLAN_BUSINESS_PRODUCT_ID;
  const designation = row(input.designation);
  const product = row(input.product);
  const mapping = row(input.mapping);
  const price = product.price;
  const modality = parseProductSaleModality(product.saleModality);
  if (designation.kind !== 'official_cairobi_store' ||
      designation.canonicalStoreId !== OFFICIAL_STORE_CANONICAL_ID ||
      product.id !== expectedId || product.storeId !== OFFICIAL_STORE_CANONICAL_ID ||
      product.publicationStatus !== 'published' ||
      mapping.canonicalStoreId !== OFFICIAL_STORE_CANONICAL_ID ||
      mapping.productId !== expectedId || mapping.planId !== input.planId ||
      mapping.status !== 'active' ||
      typeof price !== 'number' || !Number.isFinite(price) || price <= 0 ||
      Math.abs(price * 100 - Math.round(price * 100)) > 0.000001 ||
      modality?.mode !== 'subscription' ||
      modality.subscription?.billingInterval.unit !== 'month' ||
      modality.subscription?.billingInterval.count !== 1 ||
      modality.subscription?.autoRenew !== false ||
      modality.subscription?.benefit.kind !== 'access') return null;
  return price;
};
