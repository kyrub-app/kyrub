import type { DocumentData } from 'firebase-admin/firestore';
import { adminDb } from '../firebaseAdmin.js';
import type { CanonicalPayment } from '../../src/utils/canonicalPayment.js';
import { buildCanonicalOrderFinancialProjection } from '../../shared/canonicalOrderFinancialProjection.js';
import type {
  LocalOrderFinancialContext,
  LocalOrderLineSettlementConsistency,
  LocalOrderLineSettlementStatus,
} from '../../shared/localOrderFinancialContext.js';
import { classifyCompatiblePaymentRecord } from '../payments/paymentRecordCompatibility.js';
import { resolveInPersonOrderStoreContext } from './inPersonOrderService.js';
import { summarizeLocalOrderPayable } from './localOrderPayable.js';

const MAX_PAYMENT_RECORDS_PER_ORDER = 50;

const clean = (value: unknown, max = 240): string =>
  typeof value === 'string' ? value.trim().slice(0, max) : '';

const finite = (value: unknown): number | null =>
  typeof value === 'number' && Number.isFinite(value) ? value : null;

const lineSettlementStatus = (value: unknown): LocalOrderLineSettlementStatus =>
  value === 'partial' || value === 'paid' ? value : 'unpaid';

const resolveLineSettlementConsistency = (input: {
  status: LocalOrderLineSettlementStatus;
  hasOperationalPaidQuantity: boolean;
  canonicalState: LocalOrderFinancialContext['canonicalProjection']['state'];
}): LocalOrderLineSettlementConsistency => {
  if (input.hasOperationalPaidQuantity) {
    return 'mixed_authority_requires_reconciliation';
  }
  if (input.status !== 'unpaid') {
    return 'line_settlement_ahead';
  }
  if (input.canonicalState === 'paid' || input.canonicalState === 'partial') {
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

  let payable;
  try {
    payable = summarizeLocalOrderPayable(order);
  } catch {
    throw new Error('LOCAL_ORDER_FINANCIAL_ORDER_INVALID');
  }

  const canonicalProjection = buildCanonicalOrderFinancialProjection({
    expectedAmount: payable.billableAmount,
    payments: canonicalPayments,
  });
  const status = lineSettlementStatus(order.paymentStatus);
  const lineSettlementConsistency = resolveLineSettlementConsistency({
    status,
    hasOperationalPaidQuantity: payable.hasOperationalPaidQuantity,
    canonicalState: canonicalProjection.state,
  });
  const state =
    lineSettlementConsistency === 'line_settlement_ahead' ||
    lineSettlementConsistency === 'mixed_authority_requires_reconciliation'
      ? 'reconciliation_required'
      : canonicalProjection.state;

  return {
    orderId,
    canonicalProjection,
    lineSettlement: {
      status,
      openAmount: payable.openAmount,
      operationalPaidAmount: payable.operationalPaidAmount,
      transferredAmount: payable.transferredAmount,
      hasAllocatedPaidQuantity: payable.hasOperationalPaidQuantity,
    },
    lineSettlementConsistency,
    ignoredLegacyMirrorCount,
    state,
    orderPaymentStatus: status,
    expectedAmount: canonicalProjection.expectedAmount,
    authoritativelyPaidAmount: canonicalProjection.authoritativelyPaidAmount,
    pendingPaymentCount: canonicalProjection.pendingPaymentCount,
    canonicalPaymentCount: canonicalProjection.canonicalPaymentCount,
  };
};
