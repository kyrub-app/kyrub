import { adminDb } from '../firebaseAdmin.js';
import {
  normalizeCanonicalPayment,
  type CanonicalPayment,
} from '../../src/utils/canonicalPayment.js';
import {
  normalizeCanonicalPaymentIntent,
  type ExistingOrderPaymentIntentDocument,
} from '../../src/utils/canonicalPaymentIntent.js';
import { classifyCompatiblePaymentRecord } from '../payments/paymentRecordCompatibility.js';
import { resolveInPersonOrderStoreContext } from './inPersonOrderService.js';

const MAX_PAYMENT_RECORDS_PER_ORDER = 50;

const clean = (value: unknown, maximum = 220): string =>
  typeof value === 'string' ? value.trim().slice(0, maximum) : '';

export type PendingLocalPaymentProvider = '' | 'mercado-pago' | 'store-pix';

export interface PendingLocalPaymentRecovery {
  paymentIntentId: string;
  paymentId: string;
  orderId: string;
  status: 'pending';
  amount: number;
  currency: 'BRL';
  method: 'pix';
  context: 'table' | 'pos';
  expiresAt: string;
  provider: PendingLocalPaymentProvider;
  providerReady: boolean;
}

const assertPendingPair = (input: {
  payment: CanonicalPayment;
  intent: ReturnType<typeof normalizeCanonicalPaymentIntent>;
  canonicalStoreId: string;
}): PendingLocalPaymentRecovery => {
  const { payment, intent, canonicalStoreId } = input;
  if (
    payment.context !== 'table' &&
    payment.context !== 'pos'
  ) {
    throw new Error('LOCAL_PENDING_PAYMENT_CONTEXT_INVALID');
  }
  if (
    intent.context !== payment.context ||
    intent.target.kind !== 'existing_order' ||
    intent.target.orderId !== payment.orderId ||
    intent.id !== payment.paymentIntentId ||
    intent.storeId !== canonicalStoreId ||
    payment.storeId !== canonicalStoreId ||
    intent.buyerId !== payment.buyerId ||
    intent.amount !== payment.amount ||
    intent.method !== 'pix' ||
    payment.method !== 'pix' ||
    intent.status !== 'pending' ||
    payment.status !== 'pending' ||
    intent.idempotencyKey !== payment.idempotencyKey
  ) {
    throw new Error('LOCAL_PENDING_PAYMENT_PAIR_MISMATCH');
  }

  const intentProvider = clean(intent.provider, 80);
  const paymentProvider = clean(payment.provider, 80);
  const intentProviderId = clean(intent.providerIntentId);
  const paymentProviderId = clean(payment.providerPaymentId);
  const hasProviderState = Boolean(
    intentProvider || paymentProvider || intentProviderId || paymentProviderId
  );
  const supportedProvider =
    intentProvider === 'mercado-pago' || intentProvider === 'store-pix';
  const providerReady = Boolean(
    supportedProvider &&
    paymentProvider === intentProvider &&
    intentProviderId &&
    paymentProviderId &&
    intentProviderId === paymentProviderId
  );
  if (hasProviderState && !providerReady) {
    throw new Error('LOCAL_PENDING_PAYMENT_PROVIDER_STATE_INVALID');
  }

  return {
    paymentIntentId: intent.id,
    paymentId: payment.id,
    orderId: payment.orderId,
    status: 'pending',
    amount: payment.amount,
    currency: 'BRL',
    method: 'pix',
    context: payment.context,
    expiresAt: intent.expiresAt,
    provider: providerReady ? intentProvider as PendingLocalPaymentProvider : '',
    providerReady,
  };
};

export const loadPendingLocalPayment = async (input: {
  legacyStoreId: string;
  orderId: string;
}): Promise<PendingLocalPaymentRecovery | null> => {
  const legacyStoreId = clean(input.legacyStoreId, 180);
  const orderId = clean(input.orderId);
  if (!legacyStoreId || !orderId) {
    throw new Error('LOCAL_PENDING_PAYMENT_SCOPE_REQUIRED');
  }

  const storeContext = await resolveInPersonOrderStoreContext(legacyStoreId);
  const snapshot = await adminDb
    .collection(`stores/${storeContext.canonicalStoreId}/payments`)
    .where('orderId', '==', orderId)
    .limit(MAX_PAYMENT_RECORDS_PER_ORDER)
    .get();

  if (snapshot.size >= MAX_PAYMENT_RECORDS_PER_ORDER) {
    throw new Error('LOCAL_PENDING_PAYMENT_RECONCILIATION_REQUIRED');
  }

  const pending: CanonicalPayment[] = [];
  for (const document of snapshot.docs) {
    const compatible = classifyCompatiblePaymentRecord(
      document.data(),
      storeContext.canonicalStoreId
    );
    if (compatible.kind === 'legacy_table_payment_mirror') continue;
    const payment = normalizeCanonicalPayment(compatible.payment);
    if (payment.orderId !== orderId) {
      throw new Error('LOCAL_PENDING_PAYMENT_SCOPE_MISMATCH');
    }
    if (payment.context !== 'table' && payment.context !== 'pos') {
      throw new Error('LOCAL_PENDING_PAYMENT_CONTEXT_INVALID');
    }
    if (payment.status === 'pending') pending.push(payment);
  }

  if (pending.length === 0) return null;
  if (pending.length !== 1) {
    throw new Error('LOCAL_PENDING_PAYMENT_RECONCILIATION_REQUIRED');
  }

  const payment = pending[0];
  const paymentIntentId = clean(payment.paymentIntentId);
  if (!paymentIntentId) {
    throw new Error('LOCAL_PENDING_PAYMENT_LINK_REQUIRED');
  }

  const intentSnapshot = await adminDb
    .doc(
      `stores/${storeContext.canonicalStoreId}/paymentIntents/${paymentIntentId}`
    )
    .get();
  if (!intentSnapshot.exists) {
    throw new Error('LOCAL_PENDING_PAYMENT_INTENT_NOT_FOUND');
  }
  const intent = normalizeCanonicalPaymentIntent(
    intentSnapshot.data() as ExistingOrderPaymentIntentDocument
  );

  return assertPendingPair({
    payment,
    intent,
    canonicalStoreId: storeContext.canonicalStoreId,
  });
};
