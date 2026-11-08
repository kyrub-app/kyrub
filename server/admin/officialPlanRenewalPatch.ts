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
    // Keep apply failures generic. The Super Admin simulation can identify the
    // first failed guard without exposing stored descriptions or other data.
    const conflict = (reason: string): never => {
      const code = 'OFFICIAL_RENEWAL_PATCH_CONFLICT';
      throw new PlanManagementError(
        409,
        input.apply ? code : `${code}_${reason}`,
        'Dados divergentes; nenhuma alteração realizada.'
      );
    };
    if (!product.exists) conflict('CANONICAL_PRODUCT_MISSING');
    if (!mapping.exists) conflict('OFFICIAL_MAPPING_MISSING');
    if (map?.status !== 'active') conflict('OFFICIAL_MAPPING_INACTIVE');
    if (map?.canonicalStoreId !== official.canonicalStoreId) conflict('MAPPING_STORE_MISMATCH');
    if (map?.planId !== input.planId) conflict('MAPPING_PLAN_MISMATCH');
    if (data?.price !== prices[input.planId]) conflict('PRICE_MISMATCH');
    if (data?.description !== input.expectedDescription) conflict('DESCRIPTION_MISMATCH');
    if (!modality || modality.mode !== 'subscription' || !modality.subscription ||
        modality.subscription.billingInterval.unit !== 'month' ||
        modality.subscription.billingInterval.count !== 1 ||
        modality.subscription.benefit.kind !== 'access') conflict('INVALID_MODALITY');
    if (modality?.subscription?.autoRenew !== true) conflict('AUTO_RENEW_MISMATCH');
    if (input.apply) {
      transaction.update(productRef, {
        'saleModality.subscription.autoRenew': false,
        description: input.nextDescription,
      });
    }
    return { ok: true, applied: input.apply, planId: input.planId, productId: input.productId,
      previousAutoRenew: true, nextAutoRenew: false, price: prices[input.planId] };
  });
};
