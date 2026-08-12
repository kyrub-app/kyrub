import {
  KYRUB_COMMERCIAL_PLANS_V1,
  applyKyrubCommercialPlanRuntimeOverrides,
  resetKyrubCommercialPlanRuntimeOverrides,
  type KyrubCommercialPlanId,
  type KyrubCommercialPlanRuntimeOverride,
} from '../../shared/kyrubCommercialPlans.js';
import { adminDb } from '../firebaseAdmin.js';

const PLAN_IDS: readonly KyrubCommercialPlanId[] = ['free', 'pro', 'business'];
const PLAN_CATALOG_COLLECTION = 'kyrub_admin/control_plane/plan_catalog';

const numberValue = (value: unknown): number | null =>
  typeof value === 'number' && Number.isFinite(value) ? value : null;
const integerValue = (value: unknown): number | null => {
  const parsed = numberValue(value);
  return parsed !== null && Number.isInteger(parsed) ? parsed : null;
};
const record = (value: unknown): Record<string, unknown> =>
  value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};

const overrideFromDefinition = (
  planId: KyrubCommercialPlanId,
  value: unknown
): KyrubCommercialPlanRuntimeOverride => {
  const fallback = KYRUB_COMMERCIAL_PLANS_V1[planId];
  const definition = record(value);
  const features = record(definition.features);
  const catalogEnabled = features.catalog !== false;
  const intelligenceEnabled = features.kyrubia_intelligence !== false;
  const rawLimit = definition.activeCatalogLimit;
  const storedLimit = rawLimit === null ? null : integerValue(rawLimit);
  return {
    monthlyPriceBRL:
      numberValue(definition.monthlyPriceBRL) ?? fallback.monthlyPriceBRL,
    activeCatalogLimit: catalogEnabled
      ? (rawLimit === null ? null : storedLimit ?? fallback.activeCatalogLimit)
      : 0,
    kyrubiaIntelligenceCredits: intelligenceEnabled
      ? integerValue(definition.kyrubiaIntelligenceCredits)
        ?? fallback.kyrubiaIntelligenceCredits
      : 0,
    marketplaceOriginatedSaleCommissionPercent:
      numberValue(definition.marketplaceOriginatedSaleCommissionPercent)
        ?? fallback.marketplaceOriginatedSaleCommissionPercent,
  };
};

// This is intentionally fail-safe: every hydration starts from the immutable
// compiled V1 reference. If the administrative catalog is unavailable, no
// override from an older request remains resident in the process.
export const hydrateExecutablePlanCatalog = async (): Promise<void> => {
  resetKyrubCommercialPlanRuntimeOverrides();
  try {
    const snapshots = await Promise.all(
      PLAN_IDS.map(planId =>
        adminDb.doc(`${PLAN_CATALOG_COLLECTION}/${planId}`).get()
      )
    );
    const overrides: Partial<
      Record<KyrubCommercialPlanId, KyrubCommercialPlanRuntimeOverride>
    > = {};
    snapshots.forEach((snapshot, index) => {
      if (!snapshot.exists) return;
      const planId = PLAN_IDS[index];
      const data = snapshot.data() as Record<string, unknown>;
      overrides[planId] = overrideFromDefinition(planId, data.definition);
    });
    applyKyrubCommercialPlanRuntimeOverrides(overrides);
  } catch (error) {
    console.warn(
      '[Kyrub Plans] Active catalog unavailable; compiled V1 fallback remains in force.',
      error
    );
  }
};
