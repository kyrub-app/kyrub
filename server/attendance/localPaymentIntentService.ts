import { createHash } from 'node:crypto';
import type { DocumentData } from 'firebase-admin/firestore';
import { adminDb } from '../firebaseAdmin.js';
import {
  isPaymentAuthoritativelyPaid,
  normalizeCanonicalPayment,
  type CanonicalPayment,
  type PaymentContext,
} from '../../src/utils/canonicalPayment.js';
import {
  normalizeCanonicalPaymentIntent,
  type ExistingOrderPaymentIntentDocument,
  type ExistingOrderCanonicalPaymentIntent,
} from '../../src/utils/canonicalPaymentIntent.js';
import { parseServiceLocationSnapshot } from '../../shared/serviceLocation.js';
import { parseLocalPaymentIntentCreateInput } from '../../shared/localPaymentIntent.js';
import { classifyCompatiblePaymentRecord } from '../payments/paymentRecordCompatibility.js';
import { resolveInPersonOrderStoreContext } from './inPersonOrderService.js';
import { summarizeLocalOrderPayable } from './localOrderPayable.js';

const MAX_PAYMENT_RECORDS_PER_ORDER = 50;
const INTENT_TTL_MS = 15 * 60 * 1000;

const clean = (value: unknown, max = 254): string =>
  typeof value === 'string' ? value.trim().slice(0, max) : '';

const finite = (value: unknown): number | null =>
  typeof value === 'number' && Number.isFinite(value) ? value : null;

const validEmail = (value: unknown): string => {
  const email = clean(value).toLocaleLowerCase('pt-BR');
  if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/u.test(email)) {
    throw new Error('LOCAL_PAYMENT_INTENT_PAYER_EMAIL_REQUIRED');
  }
  return email;
};

const operationalPaymentStatus = (
  value: unknown
): 'unpaid' | 'partial' | 'paid' =>
  value === 'partial' || value === 'paid' ? value : 'unpaid';

const documentToken = (value: string): string =>
  createHash('sha256').update(value).digest('base64url');

const assertEligibleLocalOrder = (
  orderId: string,
  value: DocumentData | undefined
): DocumentData => {
  if (!value || clean(value.id, 220) !== orderId) {
    throw new Error('LOCAL_PAYMENT_INTENT_ORDER_NOT_FOUND');
  }
  if (value.fulfillmentType !== 'dine_in') {
    throw new Error('LOCAL_PAYMENT_INTENT_ORDER_NOT_LOCAL');
  }
  if (value.status === 'rejected' || value.status === 'cancelled') {
    throw new Error('LOCAL_PAYMENT_INTENT_ORDER_CLOSED');
  }
  const total = finite(value.total);
  if (total === null || total <= 0) {
    throw new Error('LOCAL_PAYMENT_INTENT_ORDER_TOTAL_INVALID');
  }
  const buyerId = clean(value.buyerId, 220);
  if (!buyerId || buyerId.startsWith('local-order:')) {
    throw new Error('LOCAL_PAYMENT_INTENT_CUSTOMER_IDENTIFICATION_REQUIRED');
  }
  if (value.source === 'staff' && value.buyerIdentityStatus !== 'verified_account') {
    throw new Error('LOCAL_PAYMENT_INTENT_CUSTOMER_IDENTIFICATION_REQUIRED');
  }
  return value;
};

const paymentContextForOrder = (order: DocumentData): PaymentContext => {
  const location = parseServiceLocationSnapshot(order.serviceLocation);
  if (location) return location.kind === 'table' ? 'table' : 'pos';

  // Compatibility bridge for dine-in orders created before canonical service
  // location snapshots were mandatory. The table code is read only from the
  // authoritative server-side order and may classify the payment context, but
  // it never supplies amount, payer identity, settlement or provider state.
  if (clean(order.tableCode, 80)) return 'table';

  throw new Error('LOCAL_PAYMENT_INTENT_SERVICE_LOCATION_REQUIRED');
};

const assertExistingPair = (input: {
  intent: ExistingOrderCanonicalPaymentIntent;
  payment: CanonicalPayment;
  canonicalStoreId: string;
  orderId: string;
  buyerId: string;
  idempotencyKey: string;
  context: PaymentContext;
}): void => {
  if (
    input.intent.storeId !== input.canonicalStoreId ||
    input.intent.target.kind !== 'existing_order' ||
    input.intent.target.orderId !== input.orderId ||
    input.intent.buyerId !== input.buyerId ||
    input.intent.idempotencyKey !== input.idempotencyKey ||
    input.intent.context !== input.context ||
    input.intent.method !== 'pix' ||
    input.intent.status !== 'pending' ||
    input.payment.storeId !== input.canonicalStoreId ||
    input.payment.orderId !== input.orderId ||
    input.payment.buyerId !== input.buyerId ||
    (input.payment.paymentIntentId !== undefined &&
      input.payment.paymentIntentId !== input.intent.id) ||
    input.payment.idempotencyKey !== input.idempotencyKey ||
    input.payment.context !== input.context ||
    input.payment.method !== 'pix' ||
    input.payment.status !== 'pending' ||
    input.payment.amount !== input.intent.amount
  ) {
    throw new Error('LOCAL_PAYMENT_INTENT_IDEMPOTENCY_CONFLICT');
  }
};

export interface LocalPaymentIntentCreateResult {
  paymentIntentId: string;
  paymentId: string;
  orderId: string;
  status: 'pending';
  amount: number;
  currency: 'BRL';
  method: 'pix';
  context: 'table' | 'pos';
  expiresAt: string;
  providerReady: false;
  duplicate: boolean;
}

export const createLocalPaymentIntent = async (input: {
  authenticatedUserId: string;
  value: unknown;
  now?: Date;
}): Promise<LocalPaymentIntentCreateResult> => {
  const request = parseLocalPaymentIntentCreateInput(input.value);
  const actorUserId = clean(input.authenticatedUserId, 180);
  if (!actorUserId || actorUserId !== request.storeId) {
    throw new Error('LOCAL_PAYMENT_INTENT_FORBIDDEN');
  }

  const storeContext = await resolveInPersonOrderStoreContext(request.storeId);
  const now = input.now ?? new Date();
  if (Number.isNaN(now.getTime())) {
    throw new Error('LOCAL_PAYMENT_INTENT_TIME_INVALID');
  }
  const createdAt = now.toISOString();
  const expiresAt = new Date(now.getTime() + INTENT_TTL_MS).toISOString();
  const suffix = documentToken(
    `${storeContext.canonicalStoreId}|${request.orderId}|${request.idempotencyKey}`
  );
  const paymentIntentId = `pi_local_${suffix}`;
  const paymentId = `pay_local_${suffix}`;

  const orderRef = adminDb.doc(
    `stores/${storeContext.canonicalStoreId}/orders/${request.orderId}`
  );
  const intentRef = adminDb.doc(
    `stores/${storeContext.canonicalStoreId}/paymentIntents/${paymentIntentId}`
  );
  const paymentRef = adminDb.doc(
    `stores/${storeContext.canonicalStoreId}/payments/${paymentId}`
  );
  const paymentQuery = adminDb
    .collection(`stores/${storeContext.canonicalStoreId}/payments`)
    .where('orderId', '==', request.orderId)
    .limit(MAX_PAYMENT_RECORDS_PER_ORDER);

  return adminDb.runTransaction(async transaction => {
    const orderSnapshot = await transaction.get(orderRef);
    const order = assertEligibleLocalOrder(
      request.orderId,
      orderSnapshot.data()
    );
    const buyerId = clean(order.buyerId, 220);
    const context = paymentContextForOrder(order);
    if (context !== 'table' && context !== 'pos') {
      throw new Error('LOCAL_PAYMENT_INTENT_CONTEXT_INVALID');
    }

    const userRef = adminDb.doc(`users/${buyerId}`);
    const [userSnapshot, existingIntentSnapshot, existingPaymentSnapshot, paymentSnapshot] =
      await Promise.all([
        transaction.get(userRef),
        transaction.get(intentRef),
        transaction.get(paymentRef),
        transaction.get(paymentQuery),
      ]);

    if (existingIntentSnapshot.exists || existingPaymentSnapshot.exists) {
      if (!existingIntentSnapshot.exists || !existingPaymentSnapshot.exists) {
        throw new Error('LOCAL_PAYMENT_INTENT_IDEMPOTENCY_CONFLICT');
      }
      const savedIntent = normalizeCanonicalPaymentIntent(
        existingIntentSnapshot.data() as ExistingOrderPaymentIntentDocument
      );
      const savedPayment = normalizeCanonicalPayment(
        existingPaymentSnapshot.data() as CanonicalPayment
      );
      assertExistingPair({
        intent: savedIntent,
        payment: savedPayment,
        canonicalStoreId: storeContext.canonicalStoreId,
        orderId: request.orderId,
        buyerId,
        idempotencyKey: request.idempotencyKey,
        context,
      });
      return {
        paymentIntentId: savedIntent.id,
        paymentId: savedPayment.id,
        orderId: request.orderId,
        status: 'pending',
        amount: savedIntent.amount,
        currency: 'BRL',
        method: 'pix',
        context,
        expiresAt: savedIntent.expiresAt,
        providerReady: false,
        duplicate: true,
      };
    }

    if (!userSnapshot.exists) {
      throw new Error('LOCAL_PAYMENT_INTENT_PAYER_NOT_FOUND');
    }
    validEmail((userSnapshot.data() as DocumentData | undefined)?.email);

    if (paymentSnapshot.size >= MAX_PAYMENT_RECORDS_PER_ORDER) {
      throw new Error('LOCAL_PAYMENT_INTENT_RECONCILIATION_REQUIRED');
    }

    const canonicalPayments: CanonicalPayment[] = [];
    for (const document of paymentSnapshot.docs) {
      const compatible = classifyCompatiblePaymentRecord(
        document.data(),
        storeContext.canonicalStoreId
      );
      if (compatible.kind === 'legacy_table_payment_mirror') continue;
      const payment = compatible.payment;
      if (payment.orderId !== request.orderId) {
        throw new Error('LOCAL_PAYMENT_INTENT_PAYMENT_SCOPE_INVALID');
      }
      if (payment.context !== context) {
        throw new Error('LOCAL_PAYMENT_INTENT_PAYMENT_CONTEXT_CONFLICT');
      }
      canonicalPayments.push(payment);
    }

    if (canonicalPayments.some(payment => payment.status === 'pending')) {
      throw new Error('LOCAL_PAYMENT_INTENT_PAYMENT_ALREADY_PENDING');
    }

    let payable;
    try {
      payable = summarizeLocalOrderPayable(order);
    } catch {
      throw new Error('LOCAL_PAYMENT_INTENT_ORDER_TOTAL_INVALID');
    }
    if (payable.hasOperationalPaidQuantity) {
      throw new Error('LOCAL_PAYMENT_INTENT_RECONCILIATION_REQUIRED');
    }
    const expectedAmount = payable.billableAmount;
    const authoritativelyPaidAmount = Number(
      canonicalPayments
        .filter(payment => isPaymentAuthoritativelyPaid(payment.status))
        .reduce((sum, payment) => sum + payment.amount, 0)
        .toFixed(2)
    );
    const projectedStatus = operationalPaymentStatus(order.paymentStatus);
    if (
      (projectedStatus === 'paid' && authoritativelyPaidAmount + 0.009 < expectedAmount) ||
      (projectedStatus === 'partial' && authoritativelyPaidAmount <= 0)
    ) {
      throw new Error('LOCAL_PAYMENT_INTENT_RECONCILIATION_REQUIRED');
    }

    const amount = Number((expectedAmount - authoritativelyPaidAmount).toFixed(2));
    if (amount <= 0.009) {
      throw new Error('LOCAL_PAYMENT_INTENT_ALREADY_PAID');
    }

    const intent = normalizeCanonicalPaymentIntent({
      id: paymentIntentId,
      storeId: storeContext.canonicalStoreId,
      buyerId,
      context,
      method: 'pix',
      status: 'pending',
      amount,
      currency: 'BRL',
      provider: '',
      providerIntentId: '',
      idempotencyKey: request.idempotencyKey,
      target: {
        kind: 'existing_order',
        orderId: request.orderId,
      },
      createdAt,
      updatedAt: createdAt,
      expiresAt,
    } satisfies ExistingOrderPaymentIntentDocument);

    const payment = normalizeCanonicalPayment({
      id: paymentId,
      storeId: storeContext.canonicalStoreId,
      orderId: request.orderId,
      buyerId,
      paymentIntentId: intent.id,
      amount,
      currency: 'BRL',
      method: 'pix',
      context,
      status: 'pending',
      provider: '',
      providerPaymentId: '',
      idempotencyKey: request.idempotencyKey,
      createdAt,
      updatedAt: createdAt,
      paidAt: '',
      refundedAt: '',
    });

    transaction.set(intentRef, intent);
    transaction.set(paymentRef, payment);

    return {
      paymentIntentId: intent.id,
      paymentId: payment.id,
      orderId: request.orderId,
      status: 'pending',
      amount: intent.amount,
      currency: 'BRL',
      method: 'pix',
      context,
      expiresAt: intent.expiresAt,
      providerReady: false,
      duplicate: false,
    };
  });
};
