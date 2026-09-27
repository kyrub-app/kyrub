import type { SubscriptionBenefitKind } from './productSaleModality';

export const STORE_SUBSCRIPTION_BENEFIT_SCHEMA_VERSION = 1 as const;

export type StoreSubscriptionBenefitCycleState = 'available' | 'consumed';

export interface StoreSubscriptionBenefitCycle {
  schemaVersion: typeof STORE_SUBSCRIPTION_BENEFIT_SCHEMA_VERSION;
  id: string;
  storeId: string;
  subscriptionId: string;
  buyerId: string;
  productId: string;
  productName: string;
  benefitKind: SubscriptionBenefitKind;
  providerInvoiceId: string;
  providerPaymentId: string;
  paidAt: string;
  billingPeriodStartsAt: string;
  billingPeriodEndsAt: string;
  grantedUnits: number | null;
  consumedUnits: number;
  remainingUnits: number | null;
  state: StoreSubscriptionBenefitCycleState;
  createdAt: string;
  updatedAt: string;
}

export interface StoreSubscriptionBenefitUsage {
  schemaVersion: typeof STORE_SUBSCRIPTION_BENEFIT_SCHEMA_VERSION;
  id: string;
  storeId: string;
  subscriptionId: string;
  benefitCycleId: string;
  buyerId: string;
  productId: string;
  units: number;
  note: string;
  recordedByUserId: string;
  createdAt: string;
}

export interface ConsumeStoreSubscriptionBenefitResult {
  cycle: StoreSubscriptionBenefitCycle;
  usage: StoreSubscriptionBenefitUsage;
  duplicate: boolean;
}
