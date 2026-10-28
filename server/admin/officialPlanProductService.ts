import { adminDb } from '../firebaseAdmin.js';
import { getOfficialStoreIdentity } from './officialStoreService.js';
import { PlanManagementError } from './planManagementService.js';
import { matchesOfficialPlanProduct } from './officialPlanProductContract.js';

export interface OfficialPlanProduct {
  canonicalStoreId: string;
  productId: string;
  plan: 'pro' | 'business';
  amountMinor: number;
}

const clean = (value: unknown): string => typeof value === 'string' ? value.trim() : '';

/**
 * Validate a published, monthly recurring product against the designated official
 * store. The plan-to-product association must be explicit, never inferred from
 * product name, description or buyer-provided price.
 *
 * This guard does not create a payment or grant an entitlement.
 */
export const validateOfficialPlanProduct = async (
  productIdInput: unknown,
  expectedPlan: 'pro' | 'business',
  expectedAmountMinor: number
): Promise<OfficialPlanProduct> => {
  const official = await getOfficialStoreIdentity();
  if (!official) {
    throw new PlanManagementError(409, 'OFFICIAL_STORE_NOT_CONFIGURED', 'A loja oficial ainda não foi designada.');
  }
  const productId = clean(productIdInput);
  if (!productId || productId.includes('/')) {
    throw new PlanManagementError(400, 'OFFICIAL_PLAN_PRODUCT_REQUIRED', 'Informe um produto de assinatura válido.');
  }
  const snapshot = await adminDb.doc(`stores/${official.canonicalStoreId}/products/${productId}`).get();
  if (!snapshot.exists) {
    throw new PlanManagementError(404, 'OFFICIAL_PLAN_PRODUCT_NOT_FOUND', 'O produto não existe no catálogo da loja oficial.');
  }
  const data = snapshot.data() as Record<string, unknown>;
  if (!matchesOfficialPlanProduct(data, expectedPlan, expectedAmountMinor)) {
    throw new PlanManagementError(409, 'OFFICIAL_PLAN_PRODUCT_MISMATCH', 'O produto não corresponde ao plano mensal e preço vigentes.');
  }
  return { canonicalStoreId: official.canonicalStoreId, productId, plan: expectedPlan, amountMinor };
};
