import type { KyrubCommercialPlanId } from '../../shared/kyrubCommercialPlans.js';
import { parseProductSaleModality } from '../../shared/productSaleModality.js';
import { adminDb } from '../firebaseAdmin.js';
import { resolveCanonicalStoreIdentity } from '../identity/canonicalStoreIdentityService.js';
import { getOfficialStoreIdentity } from './officialStoreService.js';
import {
  OfficialPlanCheckoutRouteError,
  resolveCheckoutBillingRoute,
  type CheckoutBillingRoute,
} from './officialPlanCheckoutRouting.js';

/**
 * Read-only checkout boundary. Plan identity comes from an admin-owned mapping,
 * not the owner-writable product, cart payload or product title. No payment is created.
 */
export const resolvePersistedProductCheckoutRoute = async (input: {
  sellerStoreReference: string;
  productId: string;
  allowMerchantSubscription?: boolean;
}): Promise<CheckoutBillingRoute> => {
  const productId = typeof input.productId === 'string' ? input.productId.trim() : '';
  if (!/^[a-zA-Z0-9_-]{1,128}$/.test(productId)) {
    throw new OfficialPlanCheckoutRouteError('INVALID_PRODUCT_ID', 'Produto inválido.');
  }

  const [seller, official] = await Promise.all([
    resolveCanonicalStoreIdentity(input.sellerStoreReference, { requirePublishedTenant: true }),
    getOfficialStoreIdentity(),
  ]);
  const product = await adminDb.doc(`stores/${seller.canonicalStoreId}/products/${productId}`).get();
  if (!product.exists) {
    throw new OfficialPlanCheckoutRouteError('PRODUCT_NOT_FOUND', 'Produto não encontrado.');
  }
  const data = product.data() ?? {};
  if (data.publicationStatus !== 'published') {
    throw new OfficialPlanCheckoutRouteError('PRODUCT_NOT_PUBLISHED', 'Produto não publicado.');
  }
  // A platform-owned control-plane mapping is the only authority for Kyrub
  // plan identity. Store owners may edit ordinary product documents.
  const mapping = await adminDb.doc(
    `kyrub_admin/control_plane/official_plan_products/${productId}`
  ).get();
  const mappingData = mapping.exists ? mapping.data() ?? {} : {};
  if ((data.platformPlanId !== undefined && data.platformPlanId !== null) ||
      (data.kyrubPlanId !== undefined && data.kyrubPlanId !== null)) {
    throw new OfficialPlanCheckoutRouteError(
      'UNTRUSTED_PRODUCT_PLAN_TAG',
      'O identificador de plano não pode ser definido no cadastro comum.'
    );
  }
  const rawPlan = mappingData.planId;
  // A published product without a mapping is an ordinary merchant product.
  // An inactive or malformed mapping must never silently fall back to merchant billing.
  if (rawPlan !== undefined && rawPlan !== 'free' && rawPlan !== 'pro' && rawPlan !== 'business') {
    throw new OfficialPlanCheckoutRouteError('INVALID_PLATFORM_PLAN', 'Plano Kyrub inválido.');
  }
  if (mapping.exists && (
    mappingData.canonicalStoreId !== seller.canonicalStoreId ||
    official?.canonicalStoreId !== seller.canonicalStoreId ||
    mappingData.productId !== productId ||
    mappingData.status !== 'active'
  )) {
    throw new OfficialPlanCheckoutRouteError('INVALID_PLATFORM_PLAN_MAPPING', 'Vínculo oficial do plano inválido.');
  }
  const planId = (mapping.exists ? rawPlan : null) as KyrubCommercialPlanId | null;
  if (mapping.exists && planId === null) {
    throw new OfficialPlanCheckoutRouteError('INVALID_PLATFORM_PLAN_MAPPING', 'Plano oficial não identificado.');
  }
  if (planId !== null && data.contractDiscounts !== undefined) {
    throw new OfficialPlanCheckoutRouteError(
      'OFFICIAL_PLAN_CONTRACT_CHECKOUT_REQUIRED',
      'Este plano possui condições contratuais. O checkout mensal não pode ignorar seus prazos e descontos.'
    );
  }
  if (planId !== null) {
    // The Official Store owns the commercial price; the governance catalog
    // supplies feature limits, not a competing price for this checkout.
    const productPrice = data.price;
    if (typeof productPrice !== 'number' || !Number.isFinite(productPrice) ||
        productPrice < 0 || !Number.isSafeInteger(Math.round(productPrice * 100)) ||
        Math.abs(productPrice * 100 - Math.round(productPrice * 100)) > 1e-7 ||
        (planId === 'free' ? productPrice !== 0 : productPrice <= 0)) {
      throw new OfficialPlanCheckoutRouteError(
        'INVALID_OFFICIAL_PLAN_PRICE', 'Preço comercial inválido no produto da Loja Oficial.'
      );
    }
    const modality = parseProductSaleModality(data.saleModality);
    if (!modality || modality.mode !== 'subscription' ||
        modality.subscription?.billingInterval.unit !== 'month' ||
        modality.subscription.billingInterval.count !== 1 ||
        modality.subscription.benefit.kind !== 'access') {
      throw new OfficialPlanCheckoutRouteError('INVALID_PLATFORM_PLAN_PRODUCT', 'Produto de plano sem assinatura mensal válida.');
    }
  }
  // Even ordinary subscriptions must not silently enter one-time merchant billing.
  // The merchant recurring-payment contract service is a separate authorized route.
  const parsedModality = parseProductSaleModality(data.saleModality);
  if (!parsedModality) {
    throw new OfficialPlanCheckoutRouteError('INVALID_PRODUCT_SALE_MODALITY', 'Forma de venda do produto inválida.');
  }
  // The unified subscription endpoint must not accept ordinary merchandise.
  // Otherwise a non-subscription product could be routed to recurring billing.
  if (planId === null && input.allowMerchantSubscription && parsedModality.mode !== 'subscription') {
    throw new OfficialPlanCheckoutRouteError(
      'PRODUCT_NOT_SUBSCRIPTION',
      'Este produto não é uma assinatura. Utilize o checkout normal da loja.'
    );
  }
  // Reject term-based merchant offers at the unified monthly endpoint too.
  // The merchant service independently enforces this, but routing must not
  // authorize a recurring checkout that discards persisted contract terms.
  if (planId === null && input.allowMerchantSubscription &&
      parsedModality.mode === 'subscription' && data.contractDiscounts !== undefined) {
    throw new OfficialPlanCheckoutRouteError(
      'MERCHANT_CONTRACT_CHECKOUT_REQUIRED',
      'Esta assinatura possui condições contratuais. Utilize o checkout específico do contrato.'
    );
  }
  if (planId === null && parsedModality.mode === 'subscription' && !input.allowMerchantSubscription) {
    throw new OfficialPlanCheckoutRouteError(
      'MERCHANT_SUBSCRIPTION_CHECKOUT_REQUIRED',
      'Assinaturas de lojistas exigem o checkout de contratos.'
    );
  }
  return resolveCheckoutBillingRoute({
    sellerStoreId: seller.canonicalStoreId,
    officialStoreId: official?.canonicalStoreId ?? null,
    platformPlanId: planId,
  });
};
