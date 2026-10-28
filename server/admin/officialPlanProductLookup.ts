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
 * Read-only checkout boundary. The plan tag is read from the persisted product,
 * never from the cart payload or its title. No order or payment is created here.
 */
export const resolvePersistedProductCheckoutRoute = async (input: {
  sellerStoreReference: string;
  productId: string;
}): Promise<CheckoutBillingRoute> => {
  const productId = input.productId.trim();
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
  // A platform-owned control-plane mapping is the only authority for Kyrub
  // plan identity. Store owners may edit ordinary product documents.
  const mapping = await adminDb.doc(
    `kyrub_admin/control_plane/official_plan_products/${productId}`
  ).get();
  const mappingData = mapping.exists ? mapping.data() ?? {} : {};
  if (data.platformPlanId !== undefined && data.platformPlanId !== null) {
    throw new OfficialPlanCheckoutRouteError(
      'UNTRUSTED_PRODUCT_PLAN_TAG',
      'O identificador de plano não pode ser definido no cadastro comum.'
    );
  }
  const rawPlan = mappingData.planId;
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
  if (planId !== null) {
    const modality = parseProductSaleModality(data.saleModality);
    if (!modality || modality.mode !== 'subscription' ||
        modality.subscription?.billingInterval.unit !== 'month' ||
        modality.subscription.billingInterval.count !== 1 ||
        modality.subscription.benefit.kind !== 'access') {
      throw new OfficialPlanCheckoutRouteError('INVALID_PLATFORM_PLAN_PRODUCT', 'Produto de plano sem assinatura mensal válida.');
    }
  }
  return resolveCheckoutBillingRoute({
    sellerStoreId: seller.canonicalStoreId,
    officialStoreId: official?.canonicalStoreId ?? null,
    platformPlanId: planId,
  });
};
