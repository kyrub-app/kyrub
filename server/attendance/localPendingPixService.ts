import { adminDb } from '../firebaseAdmin.js';
import { normalizeCanonicalPayment, type CanonicalPayment } from '../../src/utils/canonicalPayment.js';
import {
  normalizeCanonicalPaymentIntent,
  type ExistingOrderCanonicalPaymentIntent,
  type PaymentIntentDocument,
} from '../../src/utils/canonicalPaymentIntent.js';
import { classifyCompatiblePaymentRecord } from '../payments/paymentRecordCompatibility.js';
import { getMercadoPagoPixCheckout, type MercadoPagoPixCheckout } from '../payments/mercadoPagoPixProvider.js';
import { resolveInPersonOrderStoreContext } from './inPersonOrderService.js';

const clean = (value: unknown, max = 220): string =>
  typeof value === 'string' ? value.trim().slice(0, max) : '';

const validScopeId = (value: string): boolean =>
  Boolean(value) && !value.includes('/') && !value.includes('..');

const matchesLocalPair = (
  intent: ExistingOrderCanonicalPaymentIntent,
  payment: CanonicalPayment,
  orderId: string
): boolean =>
  intent.status === 'pending' &&
  payment.status === 'pending' &&
  (intent.context === 'table' || intent.context === 'pos') &&
  payment.context === intent.context &&
  intent.target.kind === 'existing_order' &&
  intent.target.orderId === orderId &&
  payment.orderId === orderId &&
  intent.storeId === payment.storeId &&
  intent.buyerId === payment.buyerId &&
  intent.method === 'pix' &&
  payment.method === 'pix' &&
  intent.amount === payment.amount &&
  intent.idempotencyKey === payment.idempotencyKey;

export interface PendingLocalPixAttempt {
  paymentIntentId: string;
  paymentId: string;
  orderId: string;
  amount: number;
  currency: 'BRL';
  context: 'table' | 'pos';
  providerAttached: boolean;
  checkout: MercadoPagoPixCheckout | null;
}

export const loadPendingLocalPixAttempt = async (input: {
  authenticatedUserId: string;
  storeId: string;
  orderId: string;
}): Promise<PendingLocalPixAttempt | null> => {
  const storeId = clean(input.storeId, 180);
  const orderId = clean(input.orderId);
  const actorUserId = clean(input.authenticatedUserId, 180);
  if (!validScopeId(storeId) || !validScopeId(orderId)) {
    throw new Error('LOCAL_PIX_RECOVERY_SCOPE_INVALID');
  }
  if (!actorUserId || actorUserId !== storeId) {
    throw new Error('LOCAL_PIX_RECOVERY_FORBIDDEN');
  }

  const storeContext = await resolveInPersonOrderStoreContext(storeId);
  const canonicalStoreId = storeContext.canonicalStoreId;
  const [intentSnapshot, paymentSnapshot] = await Promise.all([
    adminDb
      .collection(`stores/${canonicalStoreId}/paymentIntents`)
      .where('target.orderId', '==', orderId)
      .limit(20)
      .get(),
    adminDb
      .collection(`stores/${canonicalStoreId}/payments`)
      .where('orderId', '==', orderId)
      .limit(50)
      .get(),
  ]);

  const intents: ExistingOrderCanonicalPaymentIntent[] = [];
  for (const document of intentSnapshot.docs) {
    let normalized;
    try {
      normalized = normalizeCanonicalPaymentIntent(document.data() as PaymentIntentDocument);
    } catch {
      continue;
    }
    if (
      normalized.context !== 'marketplace' &&
      normalized.target.kind === 'existing_order' &&
      normalized.target.orderId === orderId &&
      normalized.status === 'pending'
    ) {
      intents.push(normalized);
    }
  }

  const payments: CanonicalPayment[] = [];
  for (const document of paymentSnapshot.docs) {
    const compatible = classifyCompatiblePaymentRecord(document.data(), canonicalStoreId);
    if (compatible.kind === 'legacy_table_payment_mirror') continue;
    if (
      compatible.payment.orderId === orderId &&
      compatible.payment.status === 'pending' &&
      (compatible.payment.context === 'table' || compatible.payment.context === 'pos')
    ) {
      payments.push(compatible.payment);
    }
  }

  const pairs = intents.flatMap(intent =>
    payments
      .filter(payment => matchesLocalPair(intent, payment, orderId))
      .map(payment => ({ intent, payment }))
  );

  if (pairs.length === 0) return null;
  if (pairs.length !== 1) throw new Error('LOCAL_PIX_RECOVERY_AMBIGUOUS');

  const { intent, payment } = pairs[0];
  const intentProviderId = clean(intent.providerIntentId);
  const paymentProviderId = clean(payment.providerPaymentId);
  if (
    (intent.provider && intent.provider !== 'mercado-pago') ||
    (payment.provider && payment.provider !== 'mercado-pago') ||
    (intentProviderId && paymentProviderId && intentProviderId !== paymentProviderId)
  ) {
    throw new Error('LOCAL_PIX_RECOVERY_PROVIDER_CONFLICT');
  }
  const providerPaymentId = intentProviderId || paymentProviderId;
  const checkout = providerPaymentId
    ? await getMercadoPagoPixCheckout(providerPaymentId)
    : null;

  return {
    paymentIntentId: intent.id,
    paymentId: payment.id,
    orderId,
    amount: intent.amount,
    currency: 'BRL',
    context: intent.context,
    providerAttached: Boolean(providerPaymentId),
    checkout,
  };
};
