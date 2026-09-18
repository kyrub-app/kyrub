import type { DocumentData, Transaction } from 'firebase-admin/firestore';
import { adminDb } from '../firebaseAdmin.js';
import {
  isPaymentAuthoritativelyPaid,
  normalizeCanonicalPayment,
  type CanonicalPayment,
} from '../../src/utils/canonicalPayment.js';
import {
  normalizeCanonicalPaymentIntent,
  type ExistingOrderCanonicalPaymentIntent,
  type ExistingOrderPaymentIntentDocument,
} from '../../src/utils/canonicalPaymentIntent.js';
import { parseServiceLocationSnapshot } from '../../shared/serviceLocation.js';
import { parseLocalPixProviderAttachInput } from '../../shared/localPaymentProvider.js';
import { classifyCompatiblePaymentRecord } from '../payments/paymentRecordCompatibility.js';
import type {
  PaymentProviderId,
  PixProviderCheckout,
} from '../payments/paymentProviderAdapter.js';
import {
  assertPaymentProviderBinding,
  resolvePrimaryPaymentProvider,
} from '../payments/paymentProviderPolicy.js';
import { resolveInPersonOrderStoreContext } from './inPersonOrderService.js';
import { summarizeLocalOrderPayable } from './localOrderPayable.js';

const MAX_PAYMENT_RECORDS_PER_ORDER = 50;

const clean = (value: unknown, max = 254): string =>
  typeof value === 'string' ? value.trim().slice(0, max) : '';

const payerEmail = (value: unknown): string => {
  const email = clean(value).toLocaleLowerCase('pt-BR');
  if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/u.test(email)) {
    throw new Error('LOCAL_PIX_PROVIDER_PAYER_EMAIL_REQUIRED');
  }
  return email;
};

const paymentContextForOrder = (
  order: DocumentData
): 'table' | 'pos' => {
  const location = parseServiceLocationSnapshot(order.serviceLocation);
  if (!location) throw new Error('LOCAL_PIX_PROVIDER_SERVICE_LOCATION_REQUIRED');
  return location.kind === 'table' ? 'table' : 'pos';
};

const assertLocalPair = (input: {
  intent: ExistingOrderCanonicalPaymentIntent;
  payment: CanonicalPayment;
  canonicalStoreId: string;
  paymentIntentId: string;
  paymentId: string;
}): void => {
  if (
    input.intent.id !== input.paymentIntentId ||
    input.payment.id !== input.paymentId ||
    input.intent.storeId !== input.canonicalStoreId ||
    input.payment.storeId !== input.canonicalStoreId ||
    input.intent.target.kind !== 'existing_order' ||
    input.intent.target.orderId !== input.payment.orderId ||
    input.intent.buyerId !== input.payment.buyerId ||
    input.intent.amount !== input.payment.amount ||
    input.intent.method !== 'pix' ||
    input.payment.method !== 'pix' ||
    input.intent.context !== input.payment.context ||
    (input.intent.context !== 'table' && input.intent.context !== 'pos') ||
    input.intent.idempotencyKey !== input.payment.idempotencyKey
  ) {
    throw new Error('LOCAL_PIX_PROVIDER_PAYMENT_PAIR_MISMATCH');
  }
};

const assertProviderBinding = (
  intent: ExistingOrderCanonicalPaymentIntent,
  payment: CanonicalPayment,
  selectedProvider: PaymentProviderId
): string => {
  const intentProviderId = clean(intent.providerIntentId, 220);
  const paymentProviderId = clean(payment.providerPaymentId, 220);
  const intentProvider = clean(intent.provider, 80);
  const paymentProvider = clean(payment.provider, 80);
  if (
    (intentProvider && paymentProvider && intentProvider !== paymentProvider) ||
    (intentProviderId && paymentProviderId && intentProviderId !== paymentProviderId)
  ) {
    throw new Error('LOCAL_PIX_PROVIDER_BINDING_CONFLICT');
  }
  const providerPaymentId = intentProviderId || paymentProviderId;
  try {
    assertPaymentProviderBinding({
      selectedProvider,
      boundProvider: intentProvider || paymentProvider,
      providerPaymentId,
    });
  } catch {
    throw new Error('LOCAL_PIX_PROVIDER_BINDING_CONFLICT');
  }
  return providerPaymentId;
};

interface ValidatedLocalPixContext {
  intent: ExistingOrderCanonicalPaymentIntent;
  payment: CanonicalPayment;
  email: string;
  existingProviderPaymentId: string;
}

const validateBeforeProvider = async (input: {
  transaction: Transaction;
  canonicalStoreId: string;
  paymentIntentId: string;
  paymentId: string;
  selectedProvider: PaymentProviderId;
  now: Date;
}): Promise<ValidatedLocalPixContext> => {
  const intentRef = adminDb.doc(
    `stores/${input.canonicalStoreId}/paymentIntents/${input.paymentIntentId}`
  );
  const paymentRef = adminDb.doc(
    `stores/${input.canonicalStoreId}/payments/${input.paymentId}`
  );
  const [intentSnapshot, paymentSnapshot] = await Promise.all([
    input.transaction.get(intentRef),
    input.transaction.get(paymentRef),
  ]);
  if (!intentSnapshot.exists || !paymentSnapshot.exists) {
    throw new Error('LOCAL_PIX_PROVIDER_PAYMENT_STATE_MISSING');
  }
  const intent = normalizeCanonicalPaymentIntent(
    intentSnapshot.data() as ExistingOrderPaymentIntentDocument
  );
  const payment = normalizeCanonicalPayment(
    paymentSnapshot.data() as CanonicalPayment
  );
  assertLocalPair({
    intent,
    payment,
    canonicalStoreId: input.canonicalStoreId,
    paymentIntentId: input.paymentIntentId,
    paymentId: input.paymentId,
  });
  const existingProviderPaymentId = assertProviderBinding(
    intent,
    payment,
    input.selectedProvider
  );

  if (intent.status !== 'pending' || payment.status !== 'pending') {
    if (!existingProviderPaymentId) {
      throw new Error('LOCAL_PIX_PROVIDER_PAYMENT_NOT_PENDING');
    }
  }
  if (!existingProviderPaymentId && Date.parse(intent.expiresAt) <= input.now.getTime()) {
    throw new Error('LOCAL_PIX_PROVIDER_INTENT_EXPIRED');
  }

  const orderRef = adminDb.doc(
    `stores/${input.canonicalStoreId}/orders/${intent.target.orderId}`
  );
  const userRef = adminDb.doc(`users/${intent.buyerId}`);
  const paymentQuery = adminDb
    .collection(`stores/${input.canonicalStoreId}/payments`)
    .where('orderId', '==', intent.target.orderId)
    .limit(MAX_PAYMENT_RECORDS_PER_ORDER);
  const [orderSnapshot, userSnapshot, orderPayments] = await Promise.all([
    input.transaction.get(orderRef),
    input.transaction.get(userRef),
    input.transaction.get(paymentQuery),
  ]);
  if (!orderSnapshot.exists) throw new Error('LOCAL_PIX_PROVIDER_ORDER_NOT_FOUND');
  if (!userSnapshot.exists) throw new Error('LOCAL_PIX_PROVIDER_PAYER_NOT_FOUND');
  const order = orderSnapshot.data() as DocumentData;
  if (
    clean(order.id, 220) !== intent.target.orderId ||
    order.fulfillmentType !== 'dine_in' ||
    order.status === 'rejected' ||
    order.status === 'cancelled'
  ) {
    throw new Error('LOCAL_PIX_PROVIDER_ORDER_NOT_ELIGIBLE');
  }
  if (clean(order.buyerId, 220) !== intent.buyerId) {
    throw new Error('LOCAL_PIX_PROVIDER_BUYER_CHANGED');
  }
  if (
    order.source === 'staff' &&
    order.buyerIdentityStatus !== 'verified_account'
  ) {
    throw new Error('LOCAL_PIX_PROVIDER_CUSTOMER_IDENTIFICATION_REQUIRED');
  }
  if (
    order.source === 'customer' &&
    order.status === 'pending' &&
    !clean(order.operatorId, 180)
  ) {
    throw new Error('LOCAL_PIX_PROVIDER_ATTENDANCE_APPROVAL_REQUIRED');
  }
  if (paymentContextForOrder(order) !== intent.context) {
    throw new Error('LOCAL_PIX_PROVIDER_CONTEXT_CHANGED');
  }

  let payable;
  try {
    payable = summarizeLocalOrderPayable(order);
  } catch {
    throw new Error('LOCAL_PIX_PROVIDER_ORDER_TOTAL_INVALID');
  }
  if (payable.hasOperationalPaidQuantity) {
    throw new Error('LOCAL_PIX_PROVIDER_INTENT_STALE');
  }

  if (orderPayments.size >= MAX_PAYMENT_RECORDS_PER_ORDER) {
    throw new Error('LOCAL_PIX_PROVIDER_PAYMENT_HISTORY_LIMIT');
  }
  let currentFound = false;
  let authoritativelyPaidAmount = 0;
  for (const document of orderPayments.docs) {
    const compatible = classifyCompatiblePaymentRecord(
      document.data(),
      input.canonicalStoreId
    );
    if (compatible.kind === 'legacy_table_payment_mirror') continue;
    const candidate = compatible.payment;
    if (candidate.orderId !== intent.target.orderId) {
      throw new Error('LOCAL_PIX_PROVIDER_PAYMENT_SCOPE_INVALID');
    }
    if (candidate.context !== intent.context) {
      throw new Error('LOCAL_PIX_PROVIDER_PAYMENT_CONTEXT_CONFLICT');
    }
    if (candidate.id === payment.id) {
      currentFound = true;
      continue;
    }
    if (candidate.status === 'pending') {
      throw new Error('LOCAL_PIX_PROVIDER_OTHER_PAYMENT_PENDING');
    }
    if (isPaymentAuthoritativelyPaid(candidate.status)) {
      authoritativelyPaidAmount += candidate.amount;
    }
  }
  if (!currentFound) throw new Error('LOCAL_PIX_PROVIDER_PAYMENT_NOT_INDEXED');

  const remaining = Number(
    (payable.billableAmount - authoritativelyPaidAmount).toFixed(2)
  );
  if (Math.abs(remaining - intent.amount) > 0.009) {
    throw new Error('LOCAL_PIX_PROVIDER_INTENT_STALE');
  }

  return {
    intent,
    payment,
    email: payerEmail((userSnapshot.data() as DocumentData | undefined)?.email),
    existingProviderPaymentId,
  };
};

const bindProviderPayment = async (input: {
  canonicalStoreId: string;
  paymentIntentId: string;
  paymentId: string;
  provider: PaymentProviderId;
  providerPaymentId: string;
  updatedAt: string;
}): Promise<void> => {
  const intentRef = adminDb.doc(
    `stores/${input.canonicalStoreId}/paymentIntents/${input.paymentIntentId}`
  );
  const paymentRef = adminDb.doc(
    `stores/${input.canonicalStoreId}/payments/${input.paymentId}`
  );
  await adminDb.runTransaction(async transaction => {
    const [intentSnapshot, paymentSnapshot] = await Promise.all([
      transaction.get(intentRef),
      transaction.get(paymentRef),
    ]);
    if (!intentSnapshot.exists || !paymentSnapshot.exists) {
      throw new Error('LOCAL_PIX_PROVIDER_PAYMENT_STATE_MISSING');
    }
    const intent = normalizeCanonicalPaymentIntent(
      intentSnapshot.data() as ExistingOrderPaymentIntentDocument
    );
    const payment = normalizeCanonicalPayment(
      paymentSnapshot.data() as CanonicalPayment
    );
    assertLocalPair({
      intent,
      payment,
      canonicalStoreId: input.canonicalStoreId,
      paymentIntentId: input.paymentIntentId,
      paymentId: input.paymentId,
    });
    const existingProviderPaymentId = assertProviderBinding(
      intent,
      payment,
      input.provider
    );
    if (
      existingProviderPaymentId &&
      existingProviderPaymentId !== input.providerPaymentId
    ) {
      throw new Error('LOCAL_PIX_PROVIDER_BINDING_CONFLICT');
    }
    if (!intent.providerIntentId || !intent.provider) {
      transaction.update(intentRef, {
        provider: input.provider,
        providerIntentId: input.providerPaymentId,
        updatedAt: input.updatedAt,
      });
    }
    if (!payment.providerPaymentId || !payment.provider) {
      transaction.update(paymentRef, {
        provider: input.provider,
        providerPaymentId: input.providerPaymentId,
        updatedAt: input.updatedAt,
      });
    }
  });
};

export interface LocalPixProviderResult extends PixProviderCheckout {
  paymentIntentId: string;
  paymentId: string;
  orderId: string;
  amount: number;
  currency: 'BRL';
  context: 'table' | 'pos';
}

export const attachPixProviderToLocalIntent = async (input: {
  authenticatedUserId: string;
  value: unknown;
  now?: Date;
}): Promise<LocalPixProviderResult> => {
  const request = parseLocalPixProviderAttachInput(input.value);
  const actorUserId = clean(input.authenticatedUserId, 180);
  if (!actorUserId || actorUserId !== request.storeId) {
    throw new Error('LOCAL_PIX_PROVIDER_FORBIDDEN');
  }
  const storeContext = await resolveInPersonOrderStoreContext(request.storeId);
  const provider = resolvePrimaryPaymentProvider();
  const now = input.now ?? new Date();
  if (Number.isNaN(now.getTime())) throw new Error('LOCAL_PIX_PROVIDER_TIME_INVALID');

  const validated = await adminDb.runTransaction(transaction =>
    validateBeforeProvider({
      transaction,
      canonicalStoreId: storeContext.canonicalStoreId,
      paymentIntentId: request.paymentIntentId,
      paymentId: request.paymentId,
      selectedProvider: provider.id,
      now,
    })
  );

  const pix = validated.existingProviderPaymentId
    ? await provider.getPixCheckout(validated.existingProviderPaymentId)
    : await provider.createLocalPixPayment({
        intent: validated.intent,
        paymentId: validated.payment.id,
        payerEmail: validated.email,
      });

  if (!pix.providerPaymentId || pix.provider !== provider.id) {
    throw new Error('LOCAL_PIX_PROVIDER_PAYMENT_ID_MISSING');
  }
  await bindProviderPayment({
    canonicalStoreId: storeContext.canonicalStoreId,
    paymentIntentId: validated.intent.id,
    paymentId: validated.payment.id,
    provider: provider.id,
    providerPaymentId: pix.providerPaymentId,
    updatedAt: new Date().toISOString(),
  });

  return {
    ...pix,
    paymentIntentId: validated.intent.id,
    paymentId: validated.payment.id,
    orderId: validated.intent.target.orderId,
    amount: validated.intent.amount,
    currency: 'BRL',
    context: validated.intent.context,
  };
};

/**
 * Compatibility alias for the existing local-attendance router. The execution
 * is provider-neutral now; Mercado Pago remains only the default adapter.
 */
export const attachMercadoPagoPixToLocalIntent = attachPixProviderToLocalIntent;
