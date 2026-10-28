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
  // Legacy publicProducts remain owner-writable. A missing canonical product
  // must fail closed; never infer a platform plan from the legacy array.
  // Until product-tag writes are platform-admin-only, reject any privileged tag.
  if (data.platformPlanId !== undefined && data.platformPlanId !== null) {
    throw new OfficialPlanCheckoutRouteError(
      'PLATFORM_PLAN_TAG_NOT_AUTHORIZED',
      'Produto de plano aguarda cadastro protegido pela plataforma.'
    );
  }
  const rawTag = data.platformPlanId;
  if (rawTag !== undefined && rawTag !== null &&
      rawTag !== 'free' && rawTag !== 'pro' && rawTag !== 'business') {
    throw new OfficialPlanCheckoutRouteError('INVALID_PLATFORM_PLAN', 'Identificação de plano inválida.');
  }
  const planId = (rawTag ?? null) as KyrubCommercialPlanId | null;
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
