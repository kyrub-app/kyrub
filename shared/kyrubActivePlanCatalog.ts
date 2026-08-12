import type { KyrubCommercialPlanId } from './kyrubCommercialPlans.js';
import type { KyrubPlanFeatureStates } from './kyrubPlanManagement.js';

export type KyrubActivePlanCatalogSource = 'control_plane' | 'compiled_v1';

export type KyrubActivePlanPublicEntry = {
  schemaVersion: 1;
  planId: KyrubCommercialPlanId;
  version: number;
  monthlyPriceBRL: number;
  activeCatalogLimit: number | null;
  kyrubiaIntelligenceCredits: number;
  marketplaceOriginatedSaleCommissionPercent: number;
  features: KyrubPlanFeatureStates;
  effectiveFrom: string | null;
  source: KyrubActivePlanCatalogSource;
};

export type KyrubActivePlanCatalogSnapshot = {
  schemaVersion: 1;
  generatedAt: string;
  plans: KyrubActivePlanPublicEntry[];
};
