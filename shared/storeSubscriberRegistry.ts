import type {
  StoreSubscriptionProviderStatus,
  StoreSubscriptionState,
} from './storeSubscriptionBilling';
import type { ProductSubscriptionTerms } from './productSaleModality';

export const STORE_SUBSCRIBER_REGISTRY_SCHEMA_VERSION = 1 as const;

export interface StoreSubscriberSubscriptionSummary {
  id: string;
  productId: string;
  productName: string;
  amountMinor: number;
  currency: 'BRL';
  state: StoreSubscriptionState;
  providerStatus: StoreSubscriptionProviderStatus;
  terms: ProductSubscriptionTerms;
  createdAt: string;
  updatedAt: string;
  activatedAt: string;
  cancelledAt: string;
  paymentConfirmedAt: string;
}

export interface StoreSubscriberSummary {
  customerId: string;
  displayName: string;
  email: string;
  photoUrl: string;
  subscriptionCount: number;
  pendingSubscriptions: number;
  activeSubscriptions: number;
  paymentDueSubscriptions: number;
  pausedSubscriptions: number;
  cancelledSubscriptions: number;
  firstSubscribedAt: string;
  lastActivityAt: string;
  subscriptions: StoreSubscriberSubscriptionSummary[];
}

export interface StoreSubscriberRegistrySummary {
  schemaVersion: typeof STORE_SUBSCRIBER_REGISTRY_SCHEMA_VERSION;
  storeId: string;
  generatedAt: string;
  subscriberCount: number;
  activeSubscriberCount: number;
  paymentDueSubscriberCount: number;
  subscribers: StoreSubscriberSummary[];
}

export interface StoreSubscriberCrmReconciliationResult {
  storeId: string;
  canonicalSubscriptionCount: number;
  paidRelationshipCount: number;
  customersSynced: number;
}
