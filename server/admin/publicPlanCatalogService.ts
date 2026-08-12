import type {
  KyrubActivePlanCatalogSnapshot,
  KyrubActivePlanPublicEntry,
} from '../../shared/kyrubActivePlanCatalog.js';
import {
  KYRUB_BOOTSTRAP_PLAN_CATALOG,
  type KyrubPlanFeatureStates,
} from '../../shared/kyrubPlanManagement.js';
import type { KyrubCommercialPlanId } from '../../shared/kyrubCommercialPlans.js';
import { adminDb } from '../firebaseAdmin.js';

const PLAN_IDS: readonly KyrubCommercialPlanId[] = ['free', 'pro', 'business'];
const PLAN_CATALOG_COLLECTION = 'kyrub_admin/control_plane/plan_catalog';

const record = (value: unknown): Record<string, unknown> =>
  value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
const numberValue = (value: unknown): number | null =>
  typeof value === 'number' && Number.isFinite(value) ? value : null;
const integerValue = (value: unknown): number | null => {
  const parsed = numberValue(value);
  return parsed !== null && Number.isInteger(parsed) ? parsed : null;
};
const nullableIso = (value: unknown): string | null => {
  if (typeof value !== 'string' || !value.trim()) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
};

const featureStates = (
  value: unknown,
  fallback: KyrubPlanFeatureStates
): KyrubPlanFeatureStates => {
  const candidate = record(value);
  const result = { ...fallback };
  for (const key of Object.keys(fallback) as Array<keyof KyrubPlanFeatureStates>) {
    if (typeof candidate[key] === 'boolean') result[key] = candidate[key] as boolean;
  }
  return result;
};

const fallbackEntry = (planId: KyrubCommercialPlanId): KyrubActivePlanPublicEntry => {
  const definition = KYRUB_BOOTSTRAP_PLAN_CATALOG[planId];
  return {
    schemaVersion: 1,
    planId,
    version: definition.version,
    monthlyPriceBRL: definition.monthlyPriceBRL,
    activeCatalogLimit: definition.activeCatalogLimit,
    kyrubiaIntelligenceCredits: definition.kyrubiaIntelligenceCredits,
    marketplaceOriginatedSaleCommissionPercent:
      definition.marketplaceOriginatedSaleCommissionPercent,
    features: { ...definition.features },
    effectiveFrom: definition.effectiveFrom,
    source: 'compiled_v1',
  };
};

const entryFromDocument = (
  planId: KyrubCommercialPlanId,
  data: Record<string, unknown>
): KyrubActivePlanPublicEntry => {
  const fallback = fallbackEntry(planId);
  const definition = record(data.definition);
  const rawLimit = definition.activeCatalogLimit;
  const activeCatalogLimit = rawLimit === null
    ? null
    : integerValue(rawLimit) ?? fallback.activeCatalogLimit;
  return {
    schemaVersion: 1,
    planId,
    version: integerValue(data.activeVersion)
      ?? integerValue(definition.version)
      ?? fallback.version,
    monthlyPriceBRL: numberValue(definition.monthlyPriceBRL)
      ?? fallback.monthlyPriceBRL,
    activeCatalogLimit,
    kyrubiaIntelligenceCredits: integerValue(definition.kyrubiaIntelligenceCredits)
      ?? fallback.kyrubiaIntelligenceCredits,
    marketplaceOriginatedSaleCommissionPercent:
      numberValue(definition.marketplaceOriginatedSaleCommissionPercent)
      ?? fallback.marketplaceOriginatedSaleCommissionPercent,
    features: featureStates(definition.features, fallback.features),
    effectiveFrom: nullableIso(definition.effectiveFrom),
    source: 'control_plane',
  };
};

export const loadPublicActivePlanCatalog = async (): Promise<KyrubActivePlanCatalogSnapshot> => {
  const plans = await Promise.all(
    PLAN_IDS.map(async planId => {
      try {
        const snapshot = await adminDb
          .doc(`${PLAN_CATALOG_COLLECTION}/${planId}`)
          .get();
        return snapshot.exists
          ? entryFromDocument(planId, snapshot.data() as Record<string, unknown>)
          : fallbackEntry(planId);
      } catch (error) {
        console.warn(
          `[Kyrub Plans] Could not read active ${planId} catalog; V1 fallback is exposed.`,
          error
        );
        return fallbackEntry(planId);
      }
    })
  );

  return {
    schemaVersion: 1,
    generatedAt: new Date().toISOString(),
    plans,
  };
};
