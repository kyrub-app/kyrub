import type { ProductSaleModality } from './productSaleModality';

export const STORE_SUBSCRIPTION_SCHEMA_VERSION = 1 as const;

export type StoreSubscriptionProviderStatus =
  | 'pending'
  | 'authorized'
  | 'paused'
  | 'cancelled';

export type StoreSubscriptionState =
  | 'pending'
  | 'active'
  | 'payment_due'
  | 'paused'
  | 'cancelled';

export type StoreSubscriptionPaymentStatus =
  | ''
  | 'pending_confirmation'
  | 'pending'
  | 'approved'
  | 'rejected'
  | 'cancelled';

export interface StoreSubscriptionSnapshot {
  schemaVersion: typeof STORE_SUBSCRIPTION_SCHEMA_VERSION;
  id: string;
  storeId: string;
  buyerId: string;
  productId: string;
  productName: string;
  amountMinor: number;
  currency: 'BRL';
  saleModality: ProductSaleModality;
  provider: 'mercado_pago';
  providerSubscriptionId: string;
  providerStatus: StoreSubscriptionProviderStatus;
  state: StoreSubscriptionState;
  checkoutUrl: string;
  providerInvoiceId: string;
  providerPaymentId: string;
  providerPaymentStatus: StoreSubscriptionPaymentStatus;
  providerPaymentStatusDetail: string;
  providerPaymentOccurredAt: string;
  createdAt: string;
  updatedAt: string;
  activatedAt: string;
  cancelledAt: string;
  paymentConfirmedAt: string;
}

export interface StoreSubscriptionCheckoutResult {
  subscription: StoreSubscriptionSnapshot;
  checkoutUrl: string;
}
