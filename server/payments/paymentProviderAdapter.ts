import type { ExistingOrderCanonicalPaymentIntent } from '../../src/utils/canonicalPaymentIntent.js';
import {
  createMercadoPagoPixPayment,
  getMercadoPagoPixCheckout,
} from './mercadoPagoPixProvider.js';

export type PaymentProviderId = 'mercado-pago';

export interface PixProviderCheckout {
  provider: PaymentProviderId;
  providerPaymentId: string;
  status: string;
  qrCode: string;
  qrCodeBase64: string;
  ticketUrl: string;
  expiresAt: string;
}

export interface CreateLocalPixPaymentInput {
  intent: ExistingOrderCanonicalPaymentIntent;
  paymentId: string;
  payerEmail: string;
}

export interface PaymentProviderAdapter {
  id: PaymentProviderId;
  createLocalPixPayment(input: CreateLocalPixPaymentInput): Promise<PixProviderCheckout>;
  getPixCheckout(providerPaymentId: string): Promise<PixProviderCheckout>;
}

const mercadoPagoAdapter: PaymentProviderAdapter = {
  id: 'mercado-pago',
  createLocalPixPayment: createMercadoPagoPixPayment,
  getPixCheckout: getMercadoPagoPixCheckout,
};

const adapters: Readonly<Record<PaymentProviderId, PaymentProviderAdapter>> = {
  'mercado-pago': mercadoPagoAdapter,
};

export const isPaymentProviderId = (value: unknown): value is PaymentProviderId =>
  value === 'mercado-pago';

export const getPaymentProviderAdapter = (providerId: string): PaymentProviderAdapter => {
  if (!isPaymentProviderId(providerId)) {
    throw new Error('PAYMENT_PROVIDER_UNSUPPORTED');
  }
  return adapters[providerId];
};
