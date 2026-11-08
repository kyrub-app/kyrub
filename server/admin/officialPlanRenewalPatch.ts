import { adminDb } from '../firebaseAdmin.js';
import { authorizeOperationsHealth } from './operationsHealthRouter.js';
import { getOfficialStoreIdentity } from './officialStoreService.js';
import { parseProductSaleModality } from '../../shared/productSaleModality.js';
import { PlanManagementError } from './planManagementService.js';

type Plan = 'pro' | 'business';
const ROOT = 'kyrub_admin/control_plane/official_plan_products';
const prices: Record<Plan, number> = { pro: 197, business: 397 };
const validId = (value: string): boolean => /^[a-zA-Z0-9_-]{1,128}$/.test(value);

/**
 * One-off guarded catalog repair. No product-wide set(), fiscal mutation, payment
 * operation or plan activation. Caller must supply the exact current description.
 */
export const patchOfficialPlanRenewal = async (input: {
  authorization: string;
  planId: Plan;
  productId: string;
  expectedDescription: string;
  nextDescription: string;
  apply: boolean;
}) => {
  const admin = await authorizeOperationsHealth(input.authorization);
  if (admin.role !== 'super_admin') throw new PlanManagementError(403, 'FORBIDDEN', 'Somente Super Admin.');
  if (!['pro', 'business'].includes(input.planId) || !validId(input.productId) ||
      typeof input.expectedDescription !== 'string' || !input.expectedDescription.includes('automátic') ||
      typeof input.nextDescription !== 'string' ||
      !input.nextDescription.includes('Pix') ||
      !input.nextDescription.includes('sem renovação automática') ||
      !input.nextDescription.includes('novo aceite') ||
      !input.nextDescription.includes('novo pagamento')) {
    throw new PlanManagementError(400, 'INVALID_RENEWAL_PATCH', 'Informe os dados exatos da correção.');
  }
  const official = await getOfficialStoreIdentity();
  if (!official?.canonicalStoreId) throw new PlanManagementError(409, 'OFFICIAL_STORE_NOT_CONFIGURED', 'Loja Oficial ausente.');
  const productRef = adminDb.doc(`stores/${official.canonicalStoreId}/products/${input.productId}`);
  const mappingRef = adminDb.doc(`${ROOT}/${input.productId}`);
  return adminDb.runTransaction(async transaction => {
    const [product, mapping] = await Promise.all([transaction.get(productRef), transaction.get(mappingRef)]);
    const data = product.data();
    const map = mapping.data();
    const modality = parseProductSaleModality(data?.saleModality);
    if (!product.exists || !mapping.exists || map?.status !== 'active' ||
        map?.canonicalStoreId !== official.canonicalStoreId || map?.planId !== input.planId ||
        data?.price !== prices[input.planId] || data?.description !== input.expectedDescription ||
        !modality || modality.mode !== 'subscription' || !modality.subscription ||
        modality.subscription.autoRenew !== true ||
        modality.subscription.billingInterval.unit !== 'month' ||
        modality.subscription.billingInterval.count !== 1 ||
        modality.subscription.benefit.kind !== 'access') {
      throw new PlanManagementError(409, 'OFFICIAL_RENEWAL_PATCH_CONFLICT', 'Dados divergentes; nenhuma alteração realizada.');
    }
    if (input.apply) {
      transaction.update(productRef, {
        'saleModality.subscription.autoRenew': false,
        description: input.nextDescription,
      });
    }
    return { ok: true, applied: input.apply, planId: input.planId, productId: input.productId,
      previousAutoRenew: true, nextAutoRenew: false, price: data.price };
  });
};
