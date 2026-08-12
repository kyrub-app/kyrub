import type {
  KyrubActivePlanCatalogSnapshot,
  KyrubActivePlanPublicEntry,
} from '../../shared/kyrubActivePlanCatalog';
import {
  applyKyrubCommercialPlanRuntimeOverrides,
  type KyrubCommercialPlanId,
} from '../../shared/kyrubCommercialPlans';

const CACHE_TTL_MS = 60_000;
let cached: { fetchedAt: number; snapshot: KyrubActivePlanCatalogSnapshot } | null = null;
let pending: Promise<KyrubActivePlanCatalogSnapshot | null> | null = null;

const PLAN_IDS: readonly KyrubCommercialPlanId[] = ['free', 'pro', 'business'];

const isEntry = (value: unknown): value is KyrubActivePlanPublicEntry => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const entry = value as Partial<KyrubActivePlanPublicEntry>;
  return (
    entry.schemaVersion === 1 &&
    typeof entry.planId === 'string' &&
    PLAN_IDS.includes(entry.planId as KyrubCommercialPlanId) &&
    typeof entry.version === 'number' &&
    Number.isInteger(entry.version) &&
    entry.version >= 1 &&
    typeof entry.monthlyPriceBRL === 'number' &&
    Number.isFinite(entry.monthlyPriceBRL) &&
    (entry.activeCatalogLimit === null ||
      (typeof entry.activeCatalogLimit === 'number' &&
        Number.isInteger(entry.activeCatalogLimit) &&
        entry.activeCatalogLimit >= 0)) &&
    typeof entry.kyrubiaIntelligenceCredits === 'number' &&
    Number.isInteger(entry.kyrubiaIntelligenceCredits) &&
    typeof entry.marketplaceOriginatedSaleCommissionPercent === 'number' &&
    Boolean(entry.features) &&
    typeof entry.features === 'object'
  );
};

const parseSnapshot = (value: unknown): KyrubActivePlanCatalogSnapshot | null => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const candidate = value as Partial<KyrubActivePlanCatalogSnapshot>;
  if (
    candidate.schemaVersion !== 1 ||
    typeof candidate.generatedAt !== 'string' ||
    !Array.isArray(candidate.plans)
  ) {
    return null;
  }
  const plans = candidate.plans.filter(isEntry);
  if (plans.length !== 3 || new Set(plans.map(plan => plan.planId)).size !== 3) {
    return null;
  }
  return {
    schemaVersion: 1,
    generatedAt: candidate.generatedAt,
    plans: plans.map(plan => ({
      ...plan,
      features: { ...plan.features },
    })),
  };
};

const applySnapshot = (snapshot: KyrubActivePlanCatalogSnapshot): void => {
  applyKyrubCommercialPlanRuntimeOverrides(
    Object.fromEntries(
      snapshot.plans.map(plan => [
        plan.planId,
        {
          monthlyPriceBRL: plan.monthlyPriceBRL,
          activeCatalogLimit: plan.features.catalog
            ? plan.activeCatalogLimit
            : 0,
          kyrubiaIntelligenceCredits: plan.features.kyrubia_intelligence
            ? plan.kyrubiaIntelligenceCredits
            : 0,
          marketplaceOriginatedSaleCommissionPercent:
            plan.marketplaceOriginatedSaleCommissionPercent,
        },
      ])
    )
  );
};

export const getActivePlanCatalogSnapshot = (): KyrubActivePlanCatalogSnapshot | null =>
  cached
    ? {
        ...cached.snapshot,
        plans: cached.snapshot.plans.map(plan => ({
          ...plan,
          features: { ...plan.features },
        })),
      }
    : null;

export const hydrateActivePlanCatalog = async (
  signal?: AbortSignal,
  force = false
): Promise<KyrubActivePlanCatalogSnapshot | null> => {
  if (!force && cached && Date.now() - cached.fetchedAt < CACHE_TTL_MS) {
    applySnapshot(cached.snapshot);
    return getActivePlanCatalogSnapshot();
  }
  if (!force && pending) return pending;

  const load = async (): Promise<KyrubActivePlanCatalogSnapshot | null> => {
    try {
      const response = await fetch('/api/plans/active', {
        method: 'GET',
        headers: { accept: 'application/json' },
        cache: 'no-store',
        credentials: 'same-origin',
        signal,
      });
      if (!response.ok) return null;
      const parsed = parseSnapshot(await response.json().catch(() => null));
      if (!parsed) return null;
      cached = { fetchedAt: Date.now(), snapshot: parsed };
      applySnapshot(parsed);
      return getActivePlanCatalogSnapshot();
    } catch (error) {
      if (signal?.aborted) throw error;
      console.warn(
        '[Kyrub Plans] Active plan catalog unavailable in browser; V1 fallback remains in use.',
        error
      );
      return null;
    } finally {
      pending = null;
    }
  };

  pending = load();
  return pending;
};

export const invalidateActivePlanCatalog = (): void => {
  cached = null;
};
