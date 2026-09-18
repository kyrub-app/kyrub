import type { DocumentData } from 'firebase-admin/firestore';
import { adminDb } from '../firebaseAdmin.js';
import {
  isPaymentAuthoritativelyPaid,
  type CanonicalPayment,
} from '../../src/utils/canonicalPayment.js';
import type {
  LocalOrderFinancialContext,
  LocalOrderFinancialState,
} from '../../shared/localOrderFinancialContext.js';
import { classifyCompatiblePaymentRecord } from '../payments/paymentRecordCompatibility.js';
import { resolveInPersonOrderStoreContext } from './inPersonOrderService.js';
import { summarizeLocalOrderPayable } from './localOrderPayable.js';

const MAX_PAYMENT_RECORDS_PER_ORDER = 50;

const clean = (value: unknown, max = 240): string =>
  typeof value === 'string' ? value.trim().slice(0, max) : '';

const finite = (value: unknown): number | null =>
  typeof value === 'number' && Number.isFinite(value) ? value : null;

const paymentStatus = (value: unknown): 'unpaid' | 'partial' | 'paid' =>
  value === 'partial' || value === 'paid' ? value : 'unpaid';

const resolveState = (input: {
  expectedAmount: number;
  operationalStatus: 'unpaid' | 'partial' | 'paid';
  hasOperationalPaidQuantity: boolean;
  payments: CanonicalPayment[];
  authoritativelyPaidAmount: number;
  pendingPaymentCount: number;
}): LocalOrderFinancialState => {
  if (input.hasOperationalPaidQuantity) return 'reconciliation_required';
  if (input.payments.length === 0) {
    return input.operationalStatus === 'unpaid'
      ? 'not_started'
      : 'reconciliation_required';
  }
  if (input.authoritativelyPaidAmount > 0) {
    return input.authoritativelyPaidAmount + 0.009 >= input.expectedAmount &&
      input.expectedAmount > 0
      ? 'paid'
      : 'partial';
  }
  if (input.pendingPaymentCount > 0) return 'pending';
  if (input.payments.every(payment => payment.status === 'refunded')) return 'refunded';
  if (input.operationalStatus !== 'unpaid') return 'reconciliation_required';
  return 'attention';
};

const assertLocalOrder = (
  orderId: string,
  value: DocumentData | undefined
): DocumentData => {
  if (!value || clean(value.id) !== orderId) {
    throw new Error('LOCAL_ORDER_FINANCIAL_ORDER_NOT_FOUND');
  }
  if (value.fulfillmentType !== 'dine_in') {
    throw new Error('LOCAL_ORDER_FINANCIAL_ORDER_NOT_LOCAL');
  }
  const total = finite(value.total);
  if (total === null || total < 0) {
    throw new Error('LOCAL_ORDER_FINANCIAL_ORDER_INVALID');
  }
  return value;
};

export const loadLocalOrderFinancialContext = async (input: {
  legacyStoreId: string;
  orderId: string;
}): Promise<LocalOrderFinancialContext> => {
  const legacyStoreId = clean(input.legacyStoreId, 180);
  const orderId = clean(input.orderId, 220);
  if (!legacyStoreId || !orderId) {
    throw new Error('LOCAL_ORDER_FINANCIAL_SCOPE_REQUIRED');
  }

  const context = await resolveInPersonOrderStoreContext(legacyStoreId);
  const [orderSnapshot, paymentSnapshot] = await Promise.all([
    adminDb.doc(`stores/${context.canonicalStoreId}/orders/${orderId}`).get(),
    adminDb.collection(`stores/${context.canonicalStoreId}/payments`)
      .where('orderId', '==', orderId)
      .limit(MAX_PAYMENT_RECORDS_PER_ORDER)
      .get(),
  ]);

  const order = assertLocalOrder(orderId, orderSnapshot.data());
  const canonicalPayments: CanonicalPayment[] = [];
  let ignoredLegacyMirrorCount = 0;

  for (const document of paymentSnapshot.docs) {
    const compatible = classifyCompatiblePaymentRecord(
      document.data(),
      context.canonicalStoreId
    );
    if (compatible.kind === 'legacy_table_payment_mirror') {
      ignoredLegacyMirrorCount += 1;
      continue;
    }
    if (compatible.payment.orderId !== orderId) {
      throw new Error('LOCAL_ORDER_FINANCIAL_PAYMENT_SCOPE_INVALID');
    }
    if (
      compatible.payment.context !== 'table' &&
      compatible.payment.context !== 'pos'
    ) {
      throw new Error('LOCAL_ORDER_FINANCIAL_PAYMENT_CONTEXT_INVALID');
    }
    canonicalPayments.push(compatible.payment);
  }

  let payable;
  try {
    payable = summarizeLocalOrderPayable(order);
  } catch {
    throw new Error('LOCAL_ORDER_FINANCIAL_ORDER_INVALID');
  }
  const expectedAmount = payable.billableAmount;
  const orderPaymentStatus = paymentStatus(order.paymentStatus);
  const paidPayments = canonicalPayments.filter(payment =>
    isPaymentAuthoritativelyPaid(payment.status)
  );
  const authoritativelyPaidAmount = Number(
    paidPayments.reduce((sum, payment) => sum + payment.amount, 0).toFixed(2)
  );
  const pendingPaymentCount = canonicalPayments.filter(
    payment => payment.status === 'pending'
  ).length;

  return {
    orderId,
    orderPaymentStatus,
    expectedAmount,
    authoritativelyPaidAmount,
    pendingPaymentCount,
    canonicalPaymentCount: canonicalPayments.length,
    ignoredLegacyMirrorCount,
    state: resolveState({
      expectedAmount,
      operationalStatus: orderPaymentStatus,
      hasOperationalPaidQuantity: payable.hasOperationalPaidQuantity,
      payments: canonicalPayments,
      authoritativelyPaidAmount,
      pendingPaymentCount,
    }),
  };
};
