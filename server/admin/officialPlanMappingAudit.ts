import { adminDb } from '../firebaseAdmin.js';
import { authorizeOperationsHealth } from './operationsHealthRouter.js';
import { getOfficialStoreIdentity } from './officialStoreService.js';
import { PlanManagementError } from './planManagementService.js';

const ROOT = 'kyrub_admin/control_plane/official_plan_products';
const TARGETS = {
  pro: 'draft_1d3dfa74091747d3a3012eadd8027894',
  business: 'draft_5f46706373714839a55846e6d8cb102c',
} as const;

/** Super Admin read-only inspection of all official mappings, including orphaned records. */
export const auditOfficialPlanMappings = async (authorization: string) => {
  const admin = await authorizeOperationsHealth(authorization);
  if (admin.role !== 'super_admin') throw new PlanManagementError(403, 'FORBIDDEN', 'Somente Super Admin.');
  const identity = await getOfficialStoreIdentity();
  if (!identity?.canonicalStoreId) throw new PlanManagementError(409, 'OFFICIAL_STORE_NOT_CONFIGURED', 'Loja Oficial ausente.');
  const storeId = identity.canonicalStoreId;
  const [mappingSnapshot, productSnapshot] = await Promise.all([
    adminDb.collection(ROOT).get(),
    adminDb.collection(`stores/${storeId}/products`).get(),
  ]);
  const products = new Map(productSnapshot.docs.map(doc => [doc.id, doc.data()]));
  const mappings = mappingSnapshot.docs.map(doc => {
    const data = doc.data();
    return {
      documentId: doc.id,
      productId: typeof data.productId === 'string' ? data.productId : null,
      planId: typeof data.planId === 'string' ? data.planId : null,
      status: typeof data.status === 'string' ? data.status : null,
      canonicalStoreMatches: data.canonicalStoreId === storeId,
      productExists: products.has(doc.id),
      productIdMatchesDocument: data.productId === doc.id,
    };
  });
  const targets = Object.entries(TARGETS).map(([planId, productId]) => {
    const product = products.get(productId);
    const direct = mappings.find(mapping => mapping.documentId === productId);
    const otherActive = mappings.filter(mapping => mapping.planId === planId && mapping.status === 'active' && mapping.documentId !== productId);
    const problems = [
      ...(!product ? ['CANONICAL_PRODUCT_MISSING'] : []),
      ...(!direct ? ['OFFICIAL_MAPPING_MISSING'] : []),
      ...(otherActive.length ? ['OTHER_ACTIVE_MAPPING_FOR_PLAN'] : []),
      ...(direct && (direct.planId !== planId || direct.status !== 'active' || !direct.canonicalStoreMatches || !direct.productIdMatchesDocument) ? ['DIRECT_MAPPING_INVALID'] : []),
    ];
    return { planId, productId, productExists: Boolean(product), directMapping: direct ?? null, otherActiveMappingIds: otherActive.map(item => item.documentId), problems, safeToConsiderMissingMapping: Boolean(product && !direct && otherActive.length === 0) };
  });
  return {
    ok: true,
    readOnly: true,
    canonicalStoreId: storeId,
    mappingCount: mappings.length,
    mappings,
    targets,
  };
};
