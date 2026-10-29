import { adminDb } from '../firebaseAdmin.js';
import { resolveCanonicalStoreIdentity } from '../identity/canonicalStoreIdentityService.js';
import { resolveSubscriptionContractQuote } from './subscriptionContractQuote.js';
import type { ContractTermMonths, SubscriptionContractOffer } from '../../shared/subscriptionContractOffers.js';
import type { SubscriptionContractPaymentTerms } from '../../shared/subscriptionContractPaymentTerms.js';
import { OfficialPlanCheckoutRouteError } from '../admin/officialPlanCheckoutRouting.js';

/**
 * Read-only server-side quote for an ordinary merchant subscription.
 * Does not create a charge or activate a contract. The persisted canonical
 * product, never the browser cart, supplies the monthly price and discounts.
 */
export const quotePersistedMerchantSubscription = async (input: {
  sellerStoreReference: string;
  productId: string;
  selectedMonths: ContractTermMonths;
  paymentTerms: SubscriptionContractPaymentTerms;
}): Promise<{ quote: SubscriptionContractOffer; paymentTerms: SubscriptionContractPaymentTerms }> => {
  const productId = typeof input.productId === 'string' ? input.productId.trim() : '';
  if (!/^[a-zA-Z0-9_-]{1,128}$/.test(productId)) {
    throw new OfficialPlanCheckoutRouteError('INVALID_PRODUCT_ID', 'Produto inválido.');
  }
  if (typeof input.sellerStoreReference !== 'string' ||
      !input.sellerStoreReference.trim()) {
    throw new OfficialPlanCheckoutRouteError('INVALID_STORE_REFERENCE', 'Loja inválida.');
  }
  const seller = await resolveCanonicalStoreIdentity(input.sellerStoreReference, {
    requirePublishedTenant: true,
  });
  const snapshot = await adminDb.doc(`stores/${seller.canonicalStoreId}/products/${productId}`).get();
  if (!snapshot.exists) {
    throw new OfficialPlanCheckoutRouteError('PRODUCT_NOT_FOUND', 'Produto não encontrado.');
  }
  const data = snapshot.data() ?? {};
  if (data.publicationStatus !== 'published') {
    throw new OfficialPlanCheckoutRouteError('PRODUCT_NOT_PUBLISHED', 'Produto não publicado.');
  }
  if (data.platformPlanId !== undefined && data.platformPlanId !== null) {
    throw new OfficialPlanCheckoutRouteError('UNTRUSTED_PRODUCT_PLAN_TAG', 'Plano inválido no produto comum.');
  }
  // A privileged mapping must never be billed using a merchant quote.
  const mapping = await adminDb.doc(
    `kyrub_admin/control_plane/official_plan_products/${productId}`
  ).get();
  if (mapping.exists) {
    throw new OfficialPlanCheckoutRouteError('OFFICIAL_PLAN_REQUIRES_PLATFORM_QUOTE', 'Use a cotação oficial do plano.');
  }
  const price = data.price;
  if (typeof price !== 'number' || !Number.isFinite(price) || price < 0 ||
      !Number.isSafeInteger(Math.round(price * 100)) ||
      Math.abs(price * 100 - Math.round(price * 100)) > 1e-7) {
    throw new OfficialPlanCheckoutRouteError('INVALID_PERSISTED_PRODUCT_PRICE', 'Preço do produto inválido.');
  }
  const quote = resolveSubscriptionContractQuote({
    persistedSaleModality: data.saleModality,
    authoritativeMonthlyPriceMinor: Math.round(price * 100),
    persistedOffers: data.contractDiscounts,
    selectedMonths: input.selectedMonths,
    paymentTerms: input.paymentTerms,
  });
  return { quote, paymentTerms: input.paymentTerms };
};
