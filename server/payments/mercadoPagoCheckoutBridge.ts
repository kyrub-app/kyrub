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
  getMercadoPagoPixCheckout,
  isMercadoPagoPixRuntimeConfigured,
  type MercadoPagoPixCheckout,
} from './mercadoPagoPixProvider.js';
import { syncMarketplaceOrderInventoryReservationExpiry } from '../inventory/marketplaceOrderInventoryReservationService.js';

export interface MercadoPagoCheckoutBridgeResult {
  providerReady: boolean;
  approvalRequired: boolean;
  orderStatus: string;
  provider: string;
  providerPaymentId: string;
  pixQrCode: string;
  pixQrCodeBase64: string;
  pixTicketUrl: string;
  expiresAt: string;
}

const emptyBridge = (
  expiresAt: string,
  input: { approvalRequired?: boolean; orderStatus?: string } = {}
): MercadoPagoCheckoutBridgeResult => ({
  providerReady: false,
  approvalRequired: input.approvalRequired === true,
  orderStatus: input.orderStatus ?? '',
  provider: '',
  providerPaymentId: '',
  pixQrCode: '',
  pixQrCodeBase64: '',
  pixTicketUrl: '',
  expiresAt,
});

const operationalOrderPath = (storeId: string, orderId: string): string =>
  `artifacts/${storeId}/public/data/customerOrders/${orderId}`;

const clean = (value: unknown): string =>
  typeof value === 'string' ? value.trim() : '';

function assertMarketplaceCheckoutContext(
  intent: NormalizedCanonicalPaymentIntent,
  payment: CanonicalPayment
): asserts intent is MarketplaceCanonicalPaymentIntent {
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
}

const assertApprovedOperationalOrder = (input: {
  data: Record<string, unknown>;
  intent: MarketplaceCanonicalPaymentIntent;
  payment: CanonicalPayment;
}): { status: string; approvalRequired: boolean } => {
  const { data, intent, payment } = input;
  if (
    clean(data.id) !== intent.target.orderId ||
    clean(data.storeId) !== intent.storeId ||
    clean(data.buyerId) !== intent.buyerId ||
    clean(data.paymentIntentId) !== intent.id ||
    clean(data.paymentId) !== payment.id
  ) {
    throw new Error('CHECKOUT_ORDER_PAYMENT_AUTHORITY_MISMATCH');
  }
  const status = clean(data.status);
  if (status === 'pending') {
    return { status, approvalRequired: true };
  }
  if (status !== 'accepted') {
    throw new Error('CHECKOUT_ORDER_NOT_PAYABLE');
  }
  if (clean(data.paymentStatus) === 'paid') {
    throw new Error('CHECKOUT_ORDER_ALREADY_PAID');
  }
  return { status, approvalRequired: false };
};

const bridgeFromPix = (
  pix: MercadoPagoPixCheckout,
  orderStatus: string
): MercadoPagoCheckoutBridgeResult => ({
  providerReady: Boolean(pix.qrCode || pix.qrCodeBase64 || pix.ticketUrl),
  approvalRequired: false,
  orderStatus,
  provider: pix.provider,
  providerPaymentId: pix.providerPaymentId,
  pixQrCode: pix.qrCode,
  pixQrCodeBase64: pix.qrCodeBase64,
  pixTicketUrl: pix.ticketUrl,
  expiresAt: pix.expiresAt,
});

export const attachMercadoPagoPixToExistingIntent = async (input: {
  storeId: string;
  paymentIntentId: string;
  paymentId: string;
  expiresAt: string;
}): Promise<MercadoPagoCheckoutBridgeResult> => {
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

  const orderRef = adminDb.doc(
    operationalOrderPath(intent.storeId, intent.target.orderId)
  );
  const orderSnapshot = await orderRef.get();
  if (!orderSnapshot.exists) throw new Error('CHECKOUT_ORDER_NOT_FOUND');
  const approval = assertApprovedOperationalOrder({
    data: orderSnapshot.data() as Record<string, unknown>,
    intent,
    payment,
  });
  if (approval.approvalRequired) {
    return emptyBridge(intent.expiresAt, {
      approvalRequired: true,
      orderStatus: approval.status,
    });
  }

  if (!(await isMercadoPagoPixRuntimeConfigured())) {
    return emptyBridge(intent.expiresAt, { orderStatus: approval.status });
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
    const existingPix = await getMercadoPagoPixCheckout(intent.providerIntentId);
    await syncMarketplaceOrderInventoryReservationExpiry(
      intent.storeId,
      intent.target.orderId,
      existingPix.expiresAt || intent.expiresAt
    );
    return bridgeFromPix(existingPix, approval.status);
  }

  const refreshedAt = new Date().toISOString();
  const refreshedExpiresAt = new Date(Date.now() + 15 * 60 * 1000).toISOString();
  const refreshedIntent: MarketplaceCanonicalPaymentIntent = {
    ...intent,
    expiresAt: refreshedExpiresAt,
    updatedAt: refreshedAt,
  };
  const pix: MercadoPagoPixCheckout = await createMercadoPagoPixPayment({
    intent: refreshedIntent,
    paymentId: payment.id,
  });
  const effectiveExpiresAt = pix.expiresAt || refreshedExpiresAt;

  await adminDb.runTransaction(async transaction => {
    const [freshIntentSnapshot, freshPaymentSnapshot, freshOrderSnapshot] = await Promise.all([
      transaction.get(intentRef),
      transaction.get(paymentRef),
      transaction.get(orderRef),
    ]);
    if (!freshIntentSnapshot.exists || !freshPaymentSnapshot.exists || !freshOrderSnapshot.exists) {
      throw new Error('CHECKOUT_PAYMENT_STATE_MISSING');
    }
    const freshIntent = normalizeCanonicalPaymentIntent(
      freshIntentSnapshot.data() as import('../../src/utils/canonicalPaymentIntent.js').CanonicalPaymentIntent
    );
    const freshPayment = normalizeCanonicalPayment(
      freshPaymentSnapshot.data() as CanonicalPayment
    );
    assertMarketplaceCheckoutContext(freshIntent, freshPayment);
    assertApprovedOperationalOrder({
      data: freshOrderSnapshot.data() as Record<string, unknown>,
      intent: freshIntent,
      payment: freshPayment,
    });
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
      expiresAt: effectiveExpiresAt,
      updatedAt: refreshedAt,
    });
    transaction.update(paymentRef, {
      provider: pix.provider,
      providerPaymentId: pix.providerPaymentId,
      updatedAt: refreshedAt,
    });
  });

  await syncMarketplaceOrderInventoryReservationExpiry(
    intent.storeId,
    intent.target.orderId,
    effectiveExpiresAt
  );

  return bridgeFromPix({ ...pix, expiresAt: effectiveExpiresAt }, approval.status);
};