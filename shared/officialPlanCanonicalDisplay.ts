import { parseProductSaleModality, type ProductSaleModality } from './productSaleModality';
import { parseSubscriptionContractDiscounts } from './subscriptionContractOffers';

export const OFFICIAL_STORE_CANONICAL_ID = 'store-ae53dc42e57eb9d5c3f7151c1431';
export const OFFICIAL_PLAN_PRODUCT_IDS = new Set([
  'draft_1d3dfa74091747d3a3012eadd8027894',
  'draft_5f46706373714839a55846e6d8cb102c',
]);

export const isOfficialPlanProductId = (productId: string): boolean =>
  OFFICIAL_PLAN_PRODUCT_IDS.has(productId);

type CanonicalTermProjection = {
  id: string;
  price: number;
  description: string;
  saleModality?: ProductSaleModality;
  contractDiscounts?: ReturnType<typeof parseSubscriptionContractDiscounts>;
};

/**
 * Project only contract terms, never overwrite a storefront offer's
 * identity, publication, price, images, inventory or supplier.
 * Both server storefront and authenticated ERP use the same guard.
 */
export const projectOfficialCanonicalProductTerms = <T extends CanonicalTermProjection>(
  offer: T,
  canonicalValue: unknown,
  canonicalStoreId: string
): T => {
  const canonical = canonicalValue && typeof canonicalValue === 'object' && !Array.isArray(canonicalValue)
    ? canonicalValue as Record<string, unknown>
    : {};
  const modality = parseProductSaleModality(canonical.saleModality);
  const contractDiscounts = canonical.contractDiscounts === undefined
    ? undefined : parseSubscriptionContractDiscounts(canonical.contractDiscounts);
  if (!isOfficialPlanProductId(offer.id) ||
      canonicalStoreId !== OFFICIAL_STORE_CANONICAL_ID ||
      canonical.id !== offer.id ||
      canonical.storeId !== canonicalStoreId ||
      canonical.publicationStatus !== 'published' ||
      canonical.price !== offer.price ||
      typeof canonical.description !== 'string' ||
      modality?.mode !== 'subscription' ||
      (canonical.contractDiscounts !== undefined && !contractDiscounts)) {
    throw new Error('OFFICIAL_PLAN_CANONICAL_TERMS_CONFLICT');
  }
  return {
    ...offer,
    description: canonical.description,
    saleModality: modality,
    contractDiscounts,
  };
};
