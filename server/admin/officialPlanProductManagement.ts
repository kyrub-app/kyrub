import { FieldValue } from 'firebase-admin/firestore';
import type { KyrubCommercialPlanId } from '../../shared/kyrubCommercialPlans.js';
import { parseProductSaleModality } from '../../shared/productSaleModality.js';
import { adminDb } from '../firebaseAdmin.js';
import { authorizeOperationsHealth } from './operationsHealthRouter.js';
import { getOfficialStoreIdentity } from './officialStoreService.js';
import { PlanManagementError } from './planManagementService.js';

const ROOT = 'kyrub_admin/control_plane/official_plan_products';
const validId = (value: string): boolean => /^[a-zA-Z0-9_-]{1,128}$/.test(value);

/** Admin-only, server-side catalog association; no direct client writes. */
export const assignOfficialPlanProduct = async (input: {
  authorization: string;
  productId: string;
  planId: KyrubCommercialPlanId;
}): Promise<void> => {
  const admin = await authorizeOperationsHealth(input.authorization);
  if (admin.role !== 'super_admin') {
    throw new PlanManagementError(403, 'PLAN_MANAGEMENT_FORBIDDEN', 'Somente Super Admin pode vincular planos.');
  }
  if (!validId(input.productId) || !['free', 'pro', 'business'].includes(input.planId)) {
    throw new PlanManagementError(400, 'INVALID_OFFICIAL_PLAN_PRODUCT', 'Produto ou plano inválido.');
  }
  const official = await getOfficialStoreIdentity();
  if (!official?.canonicalStoreId) {
    throw new PlanManagementError(409, 'OFFICIAL_STORE_NOT_CONFIGURED', 'Defina a Loja Oficial antes de vincular planos.');
  }
  const productRef = adminDb.doc(`stores/${official.canonicalStoreId}/products/${input.productId}`);
  const mappingRef = adminDb.doc(`${ROOT}/${input.productId}`);
  await adminDb.runTransaction(async transaction => {
    const [product, mapping] = await Promise.all([
      transaction.get(productRef),
      transaction.get(mappingRef),
    ]);
    const data = product.data() ?? {};
    const modality = parseProductSaleModality(data.saleModality);
    if (!product.exists || data.publicationStatus !== 'published' ||
        data.platformPlanId !== undefined ||
        !modality || modality.mode !== 'subscription' ||
        modality.subscription?.billingInterval.unit !== 'month' ||
        modality.subscription.billingInterval.count !== 1 ||
        modality.subscription.benefit.kind !== 'access') {
      throw new PlanManagementError(409, 'OFFICIAL_PLAN_PRODUCT_NOT_ELIGIBLE', 'Produto oficial não elegível para assinatura mensal.');
    }
    if (mapping.exists && mapping.data()?.canonicalStoreId !== official.canonicalStoreId) {
      throw new PlanManagementError(409, 'OFFICIAL_PLAN_MAPPING_CONFLICT', 'Vínculo pertence a outra loja.');
    }
    transaction.set(mappingRef, {
      schemaVersion: 1,
      productId: input.productId,
      canonicalStoreId: official.canonicalStoreId,
      planId: input.planId,
      status: 'active',
      updatedBy: admin.uid,
      updatedAt: FieldValue.serverTimestamp(),
    }, { merge: true });
  });
};
