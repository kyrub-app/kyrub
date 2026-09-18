import { adminDb } from '../firebaseAdmin.js';
import {
  normalizeCanonicalPaymentIntent,
  type MarketplaceCanonicalPaymentIntent,
  type NormalizedCanonicalPaymentIntent,
} from '../../src/utils/canonicalPaymentIntent.js';
import {
  normalizeCanonicalPayment,
  type CanonicalPayment,
} from '../../src/utils/canonicalPayment.js';
import {
  createMercadoPagoPixPayment,
  isMercadoPagoPixRuntimeConfigured,
  type MercadoPagoPixCheckout,
} from './mercadoPagoPixProvider.js';

export interface MercadoPagoCheckoutBridgeResult {
  providerReady: boolean;
  provider: string;
  providerPaymentId: string;
  pixQrCode: string;
  pixQrCodeBase64: string;
  pixTicketUrl: string;
  expiresAt: string;
}

const emptyBridge = (expiresAt: string): MercadoPagoCheckoutBridgeResult => ({
  providerReady: false,
  provider: '',
  providerPaymentId: '',
  pixQrCode: '',
  pixQrCodeBase64: '',
  pixTicketUrl: '',
  expiresAt,
});

const assertMarketplaceCheckoutContext = (
  intent: NormalizedCanonicalPaymentIntent,
  payment: CanonicalPayment
): asserts intent is MarketplaceCanonicalPaymentIntent => {
  if (intent.context !== payment.context) {
    throw new Error('CHECKOUT_PAYMENT_CONTEXT_MISMATCH');
  }
  if (intent.context !== 'marketplace') {
    throw new Error('CHECKOUT_PAYMENT_CONTEXT_UNSUPPORTED');
  }
  if (
    intent.target.kind !== 'marketplace_order_draft' ||
    intent.target.orderId !== payment.orderId
  ) {
    throw new Error('CHECKOUT_PAYMENT_TARGET_MISMATCH');
  }
};

export const attachMercadoPagoPixToExistingIntent = async (input: {
  storeId: string;
  paymentIntentId: string;
  paymentId: string;
  expiresAt: string;
}): Promise<MercadoPagoCheckoutBridgeResult> => {
  if (!(await isMercadoPagoPixRuntimeConfigured())) return emptyBridge(input.expiresAt);

  const intentRef = adminDb.doc(
    `stores/${input.storeId}/paymentIntents/${input.paymentIntentId}`
  );
  const paymentRef = adminDb.doc(
    `stores/${input.storeId}/payments/${input.paymentId}`
  );
  const [intentSnapshot, paymentSnapshot] = await Promise.all([
    intentRef.get(),
    paymentRef.get(),
  ]);
  if (!intentSnapshot.exists || !paymentSnapshot.exists) {
    throw new Error('CHECKOUT_PAYMENT_STATE_MISSING');
  }

  const intent = normalizeCanonicalPaymentIntent(
    intentSnapshot.data() as import('../../src/utils/canonicalPaymentIntent.js').CanonicalPaymentIntent
  );
  const payment = normalizeCanonicalPayment(
    paymentSnapshot.data() as CanonicalPayment
  );
  assertMarketplaceCheckoutContext(intent, payment);
  if (intent.status !== 'pending' || payment.status !== 'pending') {
    throw new Error('CHECKOUT_PAYMENT_NOT_PENDING');
  }

  if (intent.providerIntentId || payment.providerPaymentId) {
    if (
      intent.provider !== 'mercado-pago' ||
      payment.provider !== 'mercado-pago' ||
      !intent.providerIntentId ||
      intent.providerIntentId !== payment.providerPaymentId
    ) {
      throw new Error('CHECKOUT_PROVIDER_PAYMENT_CONFLICT');
    }
    return {
      ...emptyBridge(intent.expiresAt),
      provider: 'mercado-pago',
      providerPaymentId: intent.providerIntentId,
    };
  }

  const pix: MercadoPagoPixCheckout = await createMercadoPagoPixPayment({
    intent,
    paymentId: payment.id,
  });

  await adminDb.runTransaction(async transaction => {
    const [freshIntentSnapshot, freshPaymentSnapshot] = await Promise.all([
      transaction.get(intentRef),
      transaction.get(paymentRef),
    ]);
    if (!freshIntentSnapshot.exists || !freshPaymentSnapshot.exists) {
      throw new Error('CHECKOUT_PAYMENT_STATE_MISSING');
    }
    const freshIntent = normalizeCanonicalPaymentIntent(
      freshIntentSnapshot.data() as import('../../src/utils/canonicalPaymentIntent.js').CanonicalPaymentIntent
    );
    const freshPayment = normalizeCanonicalPayment(
      freshPaymentSnapshot.data() as CanonicalPayment
    );
    assertMarketplaceCheckoutContext(freshIntent, freshPayment);
    if (
      freshIntent.providerIntentId &&
      freshIntent.providerIntentId !== pix.providerPaymentId
    ) {
      throw new Error('CHECKOUT_PROVIDER_PAYMENT_CONFLICT');
    }
    if (
      freshPayment.providerPaymentId &&
      freshPayment.providerPaymentId !== pix.providerPaymentId
    ) {
      throw new Error('CHECKOUT_PROVIDER_PAYMENT_CONFLICT');
    }
    transaction.update(intentRef, {
      provider: pix.provider,
      providerIntentId: pix.providerPaymentId,
      updatedAt: new Date().toISOString(),
    });
    transaction.update(paymentRef, {
      provider: pix.provider,
      providerPaymentId: pix.providerPaymentId,
      updatedAt: new Date().toISOString(),
    });
  });

  return {
    providerReady: Boolean(pix.qrCode || pix.ticketUrl),
    provider: pix.provider,
    providerPaymentId: pix.providerPaymentId,
    pixQrCode: pix.qrCode,
    pixQrCodeBase64: pix.qrCodeBase64,
    pixTicketUrl: pix.ticketUrl,
    expiresAt: pix.expiresAt || input.expiresAt,
  };
};