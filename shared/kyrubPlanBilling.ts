import type { KyrubCommercialPlanId } from './kyrubCommercialPlans.js';

export const KYRUB_PLAN_BILLING_SCHEMA_VERSION = 1 as const;

export type KyrubPlanSubscriptionStatus =
  | 'pending'
  | 'authorized'
  | 'paused'
  | 'cancelled';

export type KyrubPlanBillingAvailability = {
  available: boolean;
  provider: 'mercado_pago';
};

export type KyrubPlanSubscriptionSnapshot = {
  schemaVersion: typeof KYRUB_PLAN_BILLING_SCHEMA_VERSION;
  storeId: string;
  ownerId: string;
  plan: Exclude<KyrubCommercialPlanId, 'free'>;
  planVersion: number;
  provider: 'mercado_pago';
  providerSubscriptionId: string;
  providerStatus: KyrubPlanSubscriptionStatus;
  amountMinor: number;
  currency: 'BRL';
  checkoutUrl: string;
  createdAt: string;
  updatedAt: string;
  activatedAt: string | null;
  cancelledAt: string | null;
};

export type KyrubPlanSubscriptionState = {
  billing: KyrubPlanBillingAvailability;
  subscription: KyrubPlanSubscriptionSnapshot | null;
};

export type KyrubPlanCheckoutResult = {
  checkoutUrl: string;
  subscription: KyrubPlanSubscriptionSnapshot;
};
