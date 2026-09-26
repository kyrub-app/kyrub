import type { KyrubCommercialPlanId } from './kyrubCommercialPlans.js';

export type KyrubPaidPlanId = Exclude<KyrubCommercialPlanId, 'free'>;

export type KyrubPlanSubscriptionStatus =
  | 'creating'
  | 'pending'
  | 'active'
  | 'paused'
  | 'canceled'
  | 'error';

export type KyrubPlanSubscriptionProvider = 'mercado-pago';

export interface KyrubPlanSubscriptionPublicSnapshot {
  schemaVersion: 1;
  storeId: string;
  plan: KyrubPaidPlanId;
  planVersion: number;
  monthlyPriceBRL: number;
  currency: 'BRL';
  provider: KyrubPlanSubscriptionProvider;
  status: KyrubPlanSubscriptionStatus;
  providerStatus: string;
  checkoutUrl: string;
  nextPaymentAt: string | null;
  createdAt: string | null;
  updatedAt: string | null;
  canceledAt: string | null;
}

export interface KyrubPlanSubscriptionCheckoutResult {
  status: KyrubPlanSubscriptionStatus;
  subscription: KyrubPlanSubscriptionPublicSnapshot;
  checkoutUrl: string;
}

export const isKyrubPaidPlanId = (value: unknown): value is KyrubPaidPlanId =>
  value === 'pro' || value === 'business';
