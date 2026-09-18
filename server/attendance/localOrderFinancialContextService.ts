import type { DocumentData } from 'firebase-admin/firestore';
import { adminDb } from '../firebaseAdmin.js';
import type { CanonicalPayment } from '../../src/utils/canonicalPayment.js';
import {
  buildCanonicalOrderFinancialProjection,
} from '../../shared/canonicalOrderFinancialProjection.js';
import type {
  LocalOrderFinancialContext,
  LocalOrderLineSettlementConsistency,
  LocalOrderLineSettlementStatus,
} from '../../shared/localOrderFinancialContext.js';
import { classifyCompatiblePaymentRecord } from '../payments/paymentRecordCompatibility.js';
import { resolveInPersonOrderStoreContext } from './inPersonOrderService.js';

const MAX_PAYMENT_RECORDS_PER_ORDER = 50;

const clean = (value: unknown, max = 240): string =>
  typeof value === 'string' ? value.trim().slice(0, max) : '';

const finite = (value: unknown): number | null =>
  typeof value === 'number' && Number.isFinite(value) ? value : null;

const lineSettlementStatus = (value: unknown): LocalOrderLineSettlementStatus =>
  value === 'partial' || value === 'paid' ? value : 'unpaid';

const settlementRank = (status: LocalOrderLineSettlementStatus): number =>
  status === 'paid' ? 2 : status === 'partial' ? 1 : 0;

const canonicalRank = (
  state: LocalOrderFinancialContext['canonicalProjection']['state']
): number => state === 'paid' ? 2 : state === 'partial' ? 1 : 0;

const resolveLineSettlementConsistency = (input: {
  lineSettlementStatus: LocalOrderLineSettlementStatus;
  canonicalState: LocalOrderFinancialContext['canonicalProjection']['state'];
}): LocalOrderLineSettlementConsistency => {
  if (
    input.canonicalState === 'not_started' &&
    input.lineSettlementStatus !== 'unpaid'
  ) {
    return 'line_settlement_ahead';
  }
  if (
    (input.canonicalState === 'paid' || input.canonicalState === 'partial') &&
    settlementRank(input.lineSettlementStatus) < canonicalRank(input.canonicalState)
  ) {
    return 'canonical_ahead';
  }
  return 'aligned';
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

  const canonicalProjection = buildCanonicalOrderFinancialProjection({
    expectedAmount: Number((finite(order.total) ?? 0).toFixed(2)),
    payments: canonicalPayments,
  });
  const settlementStatus = lineSettlementStatus(order.paymentStatus);
  const lineSettlementConsistency = resolveLineSettlementConsistency({
    lineSettlementStatus: settlementStatus,
    canonicalState: canonicalProjection.state,
  });
  const state = lineSettlementConsistency === 'line_settlement_ahead'
    ? 'reconciliation_required'
    : canonicalProjection.state;

  return {
    orderId,
    lineSettlementStatus: settlementStatus,
    lineSettlementConsistency,
    canonicalProjection,
    ignoredLegacyMirrorCount,
    state,
    orderPaymentStatus: settlementStatus,
    expectedAmount: canonicalProjection.expectedAmount,
    authoritativelyPaidAmount: canonicalProjection.authoritativelyPaidAmount,
    pendingPaymentCount: canonicalProjection.pendingPaymentCount,
    canonicalPaymentCount: canonicalProjection.canonicalPaymentCount,
  };
};
