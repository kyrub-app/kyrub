from pathlib import Path


def replace_once(path: str, old: str, new: str, label: str) -> None:
    p = Path(path)
    text = p.read_text()
    count = text.count(old)
    if count != 1:
        raise SystemExit(f"{label}: expected 1 match, found {count}")
    p.write_text(text.replace(old, new, 1))


# Shared request/result contracts for table-level discounts and manual tenders.
Path('shared/localTableSettlement.ts').write_text(r'''import type { PaymentMethod, PaymentStatus } from '../src/utils/canonicalPayment';

export type LocalManualTenderMethod = Exclude<PaymentMethod, 'pix'>;

export interface LocalOrderSettlementDiscountSnapshot {
  schemaVersion: 1;
  settlementId: string;
  promotionId: string;
  code: string;
  title: string;
  badge: string;
  discountType: 'percentage' | 'fixed';
  discountValue: number;
  amount: number;
  groupAmount: number;
  groupSubtotal: number;
  appliedAt: string;
  appliedBy: string;
}

export interface LocalTableCouponApplyInput {
  storeId: string;
  tableCode: string;
  couponCode: string;
  orderIds: string[];
}

export interface LocalTableCouponApplyResult {
  settlementId: string;
  promotionId: string;
  code: string;
  title: string;
  badge: string;
  discountType: 'percentage' | 'fixed';
  discountValue: number;
  eligibleProductIds: string[];
  eligibleSubtotal: number;
  subtotal: number;
  discountTotal: number;
  total: number;
  appliedAt: string;
}

export interface LocalManualTenderInput {
  storeId: string;
  tableCode: string;
  orderIds: string[];
  method: LocalManualTenderMethod;
  amount: number;
  idempotencyKey: string;
}

export interface LocalManualTenderAllocation {
  orderId: string;
  paymentIntentId: string;
  paymentId: string;
  amount: number;
}

export interface LocalManualTenderResult {
  duplicate: boolean;
  amount: number;
  method: LocalManualTenderMethod;
  createdAt: string;
  allocations: LocalManualTenderAllocation[];
}

export interface LocalOrderPaymentHistoryEntry {
  paymentId: string;
  amount: number;
  method: PaymentMethod;
  status: PaymentStatus;
  provider: string;
  createdAt: string;
  paidAt: string;
}

const clean = (value: unknown): string => typeof value === 'string' ? value.trim() : '';
const validId = (value: string, max: number): boolean => Boolean(value) && value.length <= max && !value.includes('/') && !value.includes('..');
const parseOrderIds = (value: unknown): string[] => {
  if (!Array.isArray(value)) throw new Error('LOCAL_TABLE_SETTLEMENT_ORDERS_REQUIRED');
  const ids = Array.from(new Set(value.map(item => clean(item)).filter(Boolean)));
  if (!ids.length || ids.length > 50 || ids.some(id => !validId(id, 220))) throw new Error('LOCAL_TABLE_SETTLEMENT_ORDERS_REQUIRED');
  return ids;
};

export const parseLocalTableCouponApplyInput = (value: unknown): LocalTableCouponApplyInput => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('LOCAL_TABLE_COUPON_INVALID');
  const record = value as Record<string, unknown>;
  const allowed = new Set(['storeId', 'tableCode', 'couponCode', 'orderIds']);
  if (Object.keys(record).some(key => !allowed.has(key))) throw new Error('LOCAL_TABLE_COUPON_UNSUPPORTED_FIELD');
  const storeId = clean(record.storeId);
  const tableCode = clean(record.tableCode);
  const couponCode = clean(record.couponCode).toUpperCase();
  if (!validId(storeId, 180) || !tableCode || tableCode.length > 80 || !couponCode || couponCode.length > 48) throw new Error('LOCAL_TABLE_COUPON_INVALID');
  return { storeId, tableCode, couponCode, orderIds: parseOrderIds(record.orderIds) };
};

export const parseLocalManualTenderInput = (value: unknown): LocalManualTenderInput => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('LOCAL_MANUAL_TENDER_INVALID');
  const record = value as Record<string, unknown>;
  const allowed = new Set(['storeId', 'tableCode', 'orderIds', 'method', 'amount', 'idempotencyKey']);
  if (Object.keys(record).some(key => !allowed.has(key))) throw new Error('LOCAL_MANUAL_TENDER_UNSUPPORTED_FIELD');
  const storeId = clean(record.storeId);
  const tableCode = clean(record.tableCode);
  const idempotencyKey = clean(record.idempotencyKey);
  const method = record.method;
  const amount = typeof record.amount === 'number' && Number.isFinite(record.amount) ? Number(record.amount.toFixed(2)) : 0;
  if (!validId(storeId, 180) || !tableCode || tableCode.length > 80 || !idempotencyKey || idempotencyKey.length > 180) throw new Error('LOCAL_MANUAL_TENDER_INVALID');
  if (method !== 'cash' && method !== 'card' && method !== 'other') throw new Error('LOCAL_MANUAL_TENDER_METHOD_INVALID');
  if (amount <= 0) throw new Error('LOCAL_MANUAL_TENDER_AMOUNT_INVALID');
  return { storeId, tableCode, orderIds: parseOrderIds(record.orderIds), method, amount, idempotencyKey };
};
''')

# Fix payable math: voided items do not stay billable, and a persisted coupon becomes a table/order adjustment.
replace_once(
    'server/attendance/localOrderPayable.ts',
    "export interface LocalOrderPayableSummary {\n  billableAmount: number;\n  openAmount: number;\n  operationalPaidAmount: number;\n  transferredAmount: number;\n  hasOperationalPaidQuantity: boolean;\n}",
    "export interface LocalOrderPayableSummary {\n  grossBillableAmount: number;\n  discountAmount: number;\n  billableAmount: number;\n  openAmount: number;\n  operationalPaidAmount: number;\n  transferredAmount: number;\n  voidedAmount: number;\n  hasOperationalPaidQuantity: boolean;\n}",
    'payable interface',
)
replace_once(
    'server/attendance/localOrderPayable.ts',
    "  let billableAmount = 0;\n  let openAmount = 0;\n  let operationalPaidAmount = 0;\n  let transferredAmount = 0;\n  let hasOperationalPaidQuantity = false;",
    "  let grossBillableAmount = 0;\n  let openAmount = 0;\n  let operationalPaidAmount = 0;\n  let transferredAmount = 0;\n  let voidedAmount = 0;\n  let hasOperationalPaidQuantity = false;",
    'payable accumulators',
)
replace_once(
    'server/attendance/localOrderPayable.ts',
    "    const transferred = quantity(line.transferredQuantity ?? 0);\n    if (\n      price === null ||\n      price < 0 ||\n      ordered === null ||\n      ordered <= 0 ||\n      paid === null ||\n      transferred === null ||\n      paid + transferred > ordered\n    ) {",
    "    const transferred = quantity(line.transferredQuantity ?? 0);\n    const voided = quantity(line.voidedQuantity ?? 0);\n    if (\n      price === null ||\n      price < 0 ||\n      ordered === null ||\n      ordered <= 0 ||\n      paid === null ||\n      transferred === null ||\n      voided === null ||\n      paid + transferred + voided > ordered\n    ) {",
    'payable voided validation',
)
replace_once(
    'server/attendance/localOrderPayable.ts',
    "    const billableQuantity = ordered - transferred;\n    const openQuantity = ordered - paid - transferred;\n    billableAmount += billableQuantity * price;\n    openAmount += openQuantity * price;\n    operationalPaidAmount += paid * price;\n    transferredAmount += transferred * price;\n    hasOperationalPaidQuantity ||= paid > 0;\n  }\n\n  return {\n    billableAmount: money(billableAmount),\n    openAmount: money(openAmount),\n    operationalPaidAmount: money(operationalPaidAmount),\n    transferredAmount: money(transferredAmount),\n    hasOperationalPaidQuantity,\n  };",
    "    const billableQuantity = ordered - transferred - voided;\n    const openQuantity = ordered - paid - transferred - voided;\n    grossBillableAmount += billableQuantity * price;\n    openAmount += openQuantity * price;\n    operationalPaidAmount += paid * price;\n    transferredAmount += transferred * price;\n    voidedAmount += voided * price;\n    hasOperationalPaidQuantity ||= paid > 0;\n  }\n\n  const record = value as Record<string, unknown>;\n  const discountRecord = record.settlementDiscount;\n  let discountAmount = 0;\n  if (discountRecord !== undefined && discountRecord !== null) {\n    if (!discountRecord || typeof discountRecord !== 'object' || Array.isArray(discountRecord)) {\n      throw new Error('LOCAL_ORDER_PAYABLE_DISCOUNT_INVALID');\n    }\n    const candidate = finite((discountRecord as Record<string, unknown>).amount);\n    if (candidate === null || candidate < 0) throw new Error('LOCAL_ORDER_PAYABLE_DISCOUNT_INVALID');\n    discountAmount = money(candidate);\n  }\n  const gross = money(grossBillableAmount);\n  if (discountAmount > gross + 0.009) throw new Error('LOCAL_ORDER_PAYABLE_DISCOUNT_INVALID');\n  const billableAmount = money(Math.max(0, gross - discountAmount));\n\n  return {\n    grossBillableAmount: gross,\n    discountAmount,\n    billableAmount,\n    openAmount: money(Math.max(0, openAmount - discountAmount)),\n    operationalPaidAmount: money(operationalPaidAmount),\n    transferredAmount: money(transferredAmount),\n    voidedAmount: money(voidedAmount),\n    hasOperationalPaidQuantity,\n  };",
    'payable totals',
)

# Payment intent accepts an explicit partial amount.
replace_once(
    'shared/localPaymentIntent.ts',
    "  idempotencyKey: string;\n  couponCode?: string;\n}",
    "  idempotencyKey: string;\n  couponCode?: string;\n  amount?: number;\n}",
    'intent input amount type',
)
replace_once(
    'shared/localPaymentIntent.ts',
    "const ALLOWED_FIELDS = new Set(['storeId', 'orderId', 'idempotencyKey', 'couponCode']);",
    "const ALLOWED_FIELDS = new Set(['storeId', 'orderId', 'idempotencyKey', 'couponCode', 'amount']);",
    'intent allowed fields',
)
replace_once(
    'shared/localPaymentIntent.ts',
    "  const couponCode = clean(candidate.couponCode);",
    "  const couponCode = clean(candidate.couponCode);\n  const amount = typeof candidate.amount === 'number' && Number.isFinite(candidate.amount)\n    ? Number(candidate.amount.toFixed(2))\n    : undefined;",
    'intent parse amount',
)
replace_once(
    'shared/localPaymentIntent.ts',
    "  if (couponCode.length > 48) {\n    throw new Error('LOCAL_PAYMENT_INTENT_COUPON_INVALID');\n  }",
    "  if (couponCode.length > 48) {\n    throw new Error('LOCAL_PAYMENT_INTENT_COUPON_INVALID');\n  }\n  if (candidate.amount !== undefined && (!amount || amount <= 0)) {\n    throw new Error('LOCAL_PAYMENT_INTENT_AMOUNT_INVALID');\n  }",
    'intent validate amount',
)
replace_once(
    'shared/localPaymentIntent.ts',
    "    ...(couponCode ? { couponCode } : {}),\n  };",
    "    ...(couponCode ? { couponCode } : {}),\n    ...(amount !== undefined ? { amount } : {}),\n  };",
    'intent return amount',
)

# Existing intent service: partial amount when no legacy per-intent coupon snapshot is requested.
replace_once(
    'server/attendance/localPaymentIntentService.ts',
    "const assertExistingPair = (input: { intent: ExistingOrderCanonicalPaymentIntent; payment: CanonicalPayment; canonicalStoreId: string; orderId: string; buyerId: string; idempotencyKey: string; context: LocalPaymentContext; couponCode?: string; }): void => {",
    "const assertExistingPair = (input: { intent: ExistingOrderCanonicalPaymentIntent; payment: CanonicalPayment; canonicalStoreId: string; orderId: string; buyerId: string; idempotencyKey: string; context: LocalPaymentContext; couponCode?: string; amount?: number; }): void => {",
    'intent idempotency input amount',
)
replace_once(
    'server/attendance/localPaymentIntentService.ts',
    "(input.couponCode ?? '') !== (input.intent.commercialSnapshot?.couponCode ?? '')) throw new Error('LOCAL_PAYMENT_INTENT_IDEMPOTENCY_CONFLICT');",
    "(input.couponCode ?? '') !== (input.intent.commercialSnapshot?.couponCode ?? '') || (input.amount !== undefined && Math.abs(input.amount - input.intent.amount) > 0.009)) throw new Error('LOCAL_PAYMENT_INTENT_IDEMPOTENCY_CONFLICT');",
    'intent idempotency amount check',
)
replace_once(
    'server/attendance/localPaymentIntentService.ts',
    "assertExistingPair({ intent: savedIntent, payment: savedPayment, canonicalStoreId: storeContext.canonicalStoreId, orderId: request.orderId, buyerId, idempotencyKey: request.idempotencyKey, context, couponCode: request.couponCode });",
    "assertExistingPair({ intent: savedIntent, payment: savedPayment, canonicalStoreId: storeContext.canonicalStoreId, orderId: request.orderId, buyerId, idempotencyKey: request.idempotencyKey, context, couponCode: request.couponCode, amount: request.amount });",
    'intent existing amount',
)
replace_once(
    'server/attendance/localPaymentIntentService.ts',
    "    let amount = outstandingSubtotal; let commercialSnapshot: ExistingOrderPaymentIntentDocument['commercialSnapshot'];",
    "    let amount = request.amount ?? outstandingSubtotal;\n    if (amount > outstandingSubtotal + 0.009) throw new Error('LOCAL_PAYMENT_INTENT_AMOUNT_EXCEEDS_OUTSTANDING');\n    let commercialSnapshot: ExistingOrderPaymentIntentDocument['commercialSnapshot'];",
    'intent requested amount',
)
replace_once(
    'server/attendance/localPaymentIntentService.ts',
    "      amount = Number((outstandingSubtotal - discountTotal).toFixed(2)); if (amount <= 0.009) throw new Error('LOCAL_COUPON_TOTAL_INVALID');",
    "      const discountedOutstanding = Number((outstandingSubtotal - discountTotal).toFixed(2)); if (discountedOutstanding <= 0.009) throw new Error('LOCAL_COUPON_TOTAL_INVALID');\n      if (request.amount !== undefined && Math.abs(request.amount - discountedOutstanding) > 0.009) throw new Error('LOCAL_PAYMENT_INTENT_COUPON_PARTIAL_PAYMENT_UNSUPPORTED');\n      amount = discountedOutstanding;",
    'legacy coupon partial guard',
)
# Voided lines cannot participate in old coupon snapshots either.
replace_once(
    'server/attendance/localPaymentIntentService.ts',
    "    const transferred = typeof item.transferredQuantity === 'number' && Number.isSafeInteger(item.transferredQuantity) ? item.transferredQuantity : 0;\n    const quantity = ordered === null ? null : ordered - transferred;",
    "    const transferred = typeof item.transferredQuantity === 'number' && Number.isSafeInteger(item.transferredQuantity) ? item.transferredQuantity : 0;\n    const voided = typeof item.voidedQuantity === 'number' && Number.isSafeInteger(item.voidedQuantity) ? item.voidedQuantity : 0;\n    const quantity = ordered === null ? null : ordered - transferred - voided;",
    'intent promotion excludes voided',
)

# Provider attachment/confirmation accepts a partial intent as long as it does not exceed current remaining balance.
for path, old, new, label in [
    ('server/attendance/localMercadoPagoPixService.ts', "  if (Math.abs(remaining - intent.amount) > 0.009) {\n    throw new Error('LOCAL_PIX_PROVIDER_INTENT_STALE');\n  }", "  if (intent.amount <= 0 || intent.amount > remaining + 0.009) {\n    throw new Error('LOCAL_PIX_PROVIDER_INTENT_STALE');\n  }", 'mercado pago partial'),
    ('server/attendance/localStoreOwnedPixService.ts', "  if (Math.abs(remaining - intent.amount) > 0.009) throw new Error('LOCAL_STORE_PIX_INTENT_STALE');", "  if (intent.amount <= 0 || intent.amount > remaining + 0.009) throw new Error('LOCAL_STORE_PIX_INTENT_STALE');", 'store pix partial'),
    ('server/attendance/localStoreOwnedPixConfirmationService.ts', "    if (Math.abs(remaining - payment.amount) > 0.009) throw new Error('LOCAL_STORE_PIX_CONFIRM_INTENT_STALE');", "    if (payment.amount <= 0 || payment.amount > remaining + 0.009) throw new Error('LOCAL_STORE_PIX_CONFIRM_INTENT_STALE');", 'store pix confirm partial'),
]:
    replace_once(path, old, new, label)

# Financial context exposes an auditable history and persisted discount movement.
replace_once(
    'shared/localOrderFinancialContext.ts',
    "import type {\n  CanonicalOrderFinancialProjection,\n  CanonicalOrderFinancialState,\n} from './canonicalOrderFinancialProjection';",
    "import type {\n  CanonicalOrderFinancialProjection,\n  CanonicalOrderFinancialState,\n} from './canonicalOrderFinancialProjection';\nimport type { LocalOrderPaymentHistoryEntry, LocalOrderSettlementDiscountSnapshot } from './localTableSettlement';",
    'financial context imports',
)
replace_once(
    'shared/localOrderFinancialContext.ts',
    "  canonicalPaymentCount: number;\n}",
    "  canonicalPaymentCount: number;\n  paymentHistory: LocalOrderPaymentHistoryEntry[];\n  discount: LocalOrderSettlementDiscountSnapshot | null;\n}",
    'financial context history fields',
)
replace_once(
    'server/attendance/localOrderFinancialContextService.ts',
    "import type { CanonicalPayment } from '../../src/utils/canonicalPayment.js';",
    "import type { CanonicalPayment } from '../../src/utils/canonicalPayment.js';\nimport type { LocalOrderSettlementDiscountSnapshot } from '../../shared/localTableSettlement.js';",
    'financial service discount type',
)
replace_once(
    'server/attendance/localOrderFinancialContextService.ts',
    "  const canonicalProjection = buildCanonicalOrderFinancialProjection({",
    "  const rawDiscount = order.settlementDiscount;\n  let discount: LocalOrderSettlementDiscountSnapshot | null = null;\n  if (rawDiscount && typeof rawDiscount === 'object' && !Array.isArray(rawDiscount)) {\n    const candidate = rawDiscount as LocalOrderSettlementDiscountSnapshot;\n    if (candidate.schemaVersion === 1 && clean(candidate.settlementId) && clean(candidate.code) && finite(candidate.amount) !== null) {\n      discount = candidate;\n    }\n  }\n  const paymentHistory = canonicalPayments\n    .map(payment => ({\n      paymentId: payment.id, amount: payment.amount, method: payment.method, status: payment.status,\n      provider: payment.provider, createdAt: payment.createdAt, paidAt: payment.paidAt,\n    }))\n    .sort((a, b) => (b.paidAt || b.createdAt).localeCompare(a.paidAt || a.createdAt));\n\n  const canonicalProjection = buildCanonicalOrderFinancialProjection({",
    'financial service history build',
)
replace_once(
    'server/attendance/localOrderFinancialContextService.ts',
    "    canonicalPaymentCount: canonicalProjection.canonicalPaymentCount,\n  };",
    "    canonicalPaymentCount: canonicalProjection.canonicalPaymentCount,\n    paymentHistory,\n    discount,\n  };",
    'financial service return history',
)

# New server authority for coupon persistence and operator-attested cash/card/other partial tenders.
Path('server/attendance/localTableSettlementService.ts').write_text(r'''import { createHash } from 'node:crypto';
import type { DocumentData, QuerySnapshot } from 'firebase-admin/firestore';
import { adminDb } from '../firebaseAdmin.js';
import { isPaymentAuthoritativelyPaid, normalizeCanonicalPayment, type CanonicalPayment } from '../../src/utils/canonicalPayment.js';
import { normalizeCanonicalPaymentIntent, type ExistingOrderPaymentIntentDocument } from '../../src/utils/canonicalPaymentIntent.js';
import { resolveStorePromotionForCheckout } from '../payments/storePromotionService.js';
import { classifyCompatiblePaymentRecord } from '../payments/paymentRecordCompatibility.js';
import { resolveInPersonOrderStoreContext } from './inPersonOrderService.js';
import { summarizeLocalOrderPayable } from './localOrderPayable.js';
import {
  STORE_ECONOMIC_LEDGER_SCHEMA_VERSION,
  brlToMinor,
  buildPaymentCaptureEconomicEntryId,
  storeEconomicLedgerEntryPath,
  type StoreEconomicLedgerEntry,
} from '../../shared/storeEconomicLedger.js';
import {
  parseLocalManualTenderInput,
  parseLocalTableCouponApplyInput,
  type LocalManualTenderAllocation,
  type LocalManualTenderResult,
  type LocalOrderSettlementDiscountSnapshot,
  type LocalTableCouponApplyResult,
} from '../../shared/localTableSettlement.js';

const MAX_PAYMENT_RECORDS_PER_ORDER = 50;
const clean = (value: unknown, max = 240): string => typeof value === 'string' ? value.trim().slice(0, max) : '';
const money = (value: number): number => Number(value.toFixed(2));
const token = (value: string): string => createHash('sha256').update(value).digest('base64url');
const tableKey = (value: unknown): string => clean(value, 80).toLocaleLowerCase('pt-BR');

const assertOrder = (orderId: string, tableCode: string, value: DocumentData | undefined): DocumentData => {
  if (!value || clean(value.id, 220) !== orderId) throw new Error('LOCAL_TABLE_SETTLEMENT_ORDER_NOT_FOUND');
  if (value.fulfillmentType !== 'dine_in' || tableKey(value.tableCode) !== tableKey(tableCode)) throw new Error('LOCAL_TABLE_SETTLEMENT_ORDER_SCOPE_INVALID');
  if (value.status === 'rejected' || value.status === 'cancelled') throw new Error('LOCAL_TABLE_SETTLEMENT_ORDER_CLOSED');
  return value;
};

const canonicalPayments = (snapshot: QuerySnapshot<DocumentData>, canonicalStoreId: string, orderId: string): CanonicalPayment[] => {
  if (snapshot.size >= MAX_PAYMENT_RECORDS_PER_ORDER) throw new Error('LOCAL_TABLE_SETTLEMENT_PAYMENT_HISTORY_LIMIT');
  const result: CanonicalPayment[] = [];
  for (const document of snapshot.docs) {
    const compatible = classifyCompatiblePaymentRecord(document.data(), canonicalStoreId);
    if (compatible.kind === 'legacy_table_payment_mirror') continue;
    if (compatible.payment.orderId !== orderId) throw new Error('LOCAL_TABLE_SETTLEMENT_PAYMENT_SCOPE_INVALID');
    result.push(compatible.payment);
  }
  return result;
};

const orderLines = (orderId: string, order: DocumentData) => {
  if (!Array.isArray(order.items) || !order.items.length) throw new Error('LOCAL_TABLE_SETTLEMENT_ITEMS_INVALID');
  return order.items.flatMap((candidate: unknown) => {
    if (!candidate || typeof candidate !== 'object' || Array.isArray(candidate)) throw new Error('LOCAL_TABLE_SETTLEMENT_ITEMS_INVALID');
    const item = candidate as Record<string, unknown>;
    const productId = clean(item.productId ?? item.id, 220);
    const unitPrice = typeof item.price === 'number' && Number.isFinite(item.price) ? money(item.price) : -1;
    const ordered = typeof item.quantity === 'number' && Number.isSafeInteger(item.quantity) ? item.quantity : 0;
    const transferred = typeof item.transferredQuantity === 'number' && Number.isSafeInteger(item.transferredQuantity) ? item.transferredQuantity : 0;
    const voided = typeof item.voidedQuantity === 'number' && Number.isSafeInteger(item.voidedQuantity) ? item.voidedQuantity : 0;
    const quantity = ordered - transferred - voided;
    if (!productId || unitPrice < 0 || ordered <= 0 || quantity < 0) throw new Error('LOCAL_TABLE_SETTLEMENT_ITEMS_INVALID');
    return quantity > 0 ? [{ orderId, productId, unitPrice, quantity }] : [];
  });
};

export const applyLocalTableCoupon = async (input: {
  authenticatedUserId: string;
  value: unknown;
  now?: Date;
}): Promise<LocalTableCouponApplyResult> => {
  const request = parseLocalTableCouponApplyInput(input.value);
  const actorUserId = clean(input.authenticatedUserId, 180);
  if (!actorUserId || actorUserId !== request.storeId) throw new Error('LOCAL_TABLE_COUPON_FORBIDDEN');
  const storeContext = await resolveInPersonOrderStoreContext(request.storeId);
  const now = input.now ?? new Date();
  const appliedAt = now.toISOString();
  const orderRefs = request.orderIds.map(orderId => adminDb.doc(`stores/${storeContext.canonicalStoreId}/orders/${orderId}`));
  const paymentQueries = request.orderIds.map(orderId => adminDb.collection(`stores/${storeContext.canonicalStoreId}/payments`).where('orderId', '==', orderId).limit(MAX_PAYMENT_RECORDS_PER_ORDER));

  return adminDb.runTransaction(async transaction => {
    const orderSnapshots = await Promise.all(orderRefs.map(ref => transaction.get(ref)));
    const paymentSnapshots = await Promise.all(paymentQueries.map(query => transaction.get(query)));
    const orders = orderSnapshots.map((snapshot, index) => assertOrder(request.orderIds[index]!, request.tableCode, snapshot.data()));
    const buyers = Array.from(new Set(orders.map(order => clean(order.buyerId, 220))));
    if (buyers.length !== 1 || !buyers[0] || buyers[0].startsWith('local-order:')) throw new Error('LOCAL_TABLE_COUPON_CUSTOMER_REQUIRED');

    for (let index = 0; index < orders.length; index += 1) {
      const payable = summarizeLocalOrderPayable(orders[index]);
      if (payable.hasOperationalPaidQuantity) throw new Error('LOCAL_TABLE_COUPON_RECONCILIATION_REQUIRED');
      const payments = canonicalPayments(paymentSnapshots[index]!, storeContext.canonicalStoreId, request.orderIds[index]!);
      if (payments.some(payment => payment.status === 'pending' || isPaymentAuthoritativelyPaid(payment.status))) {
        throw new Error('LOCAL_TABLE_COUPON_PAYMENT_ALREADY_STARTED');
      }
    }

    const linesByOrder = orders.map((order, index) => orderLines(request.orderIds[index]!, order));
    const allLines = linesByOrder.flat().map(({ productId, unitPrice, quantity }) => ({ productId, unitPrice, quantity }));
    const resolved = await resolveStorePromotionForCheckout({
      storeId: storeContext.canonicalStoreId,
      buyerId: buyers[0]!,
      couponCode: request.couponCode,
      lines: allLines,
      now,
    });
    const quote = resolved.quote;
    if (quote.discountTotal <= 0 || quote.total <= 0) throw new Error('LOCAL_TABLE_COUPON_TOTAL_INVALID');
    const eligibleProducts = new Set(quote.eligibleProductIds);
    const eligibleByOrder = linesByOrder.map(lines => lines.reduce((sum, line) => sum + (eligibleProducts.has(line.productId) ? Math.round(line.unitPrice * 100) * line.quantity : 0), 0));
    const eligibleTotal = eligibleByOrder.reduce((sum, value) => sum + value, 0);
    if (eligibleTotal <= 0) throw new Error('LOCAL_TABLE_COUPON_TOTAL_INVALID');
    const discountCents = Math.round(quote.discountTotal * 100);
    const allocations = eligibleByOrder.map(value => Math.floor(discountCents * value / eligibleTotal));
    let remainder = discountCents - allocations.reduce((sum, value) => sum + value, 0);
    const orderByWeight = eligibleByOrder.map((value, index) => ({ value, index })).sort((a, b) => b.value - a.value);
    let cursor = 0;
    while (remainder > 0) {
      allocations[orderByWeight[cursor % orderByWeight.length]!.index] += 1;
      remainder -= 1;
      cursor += 1;
    }
    const settlementId = `coupon_${token(`${storeContext.canonicalStoreId}|${request.tableCode}|${resolved.promotion.id}|${appliedAt}`).slice(0, 40)}`;
    for (let index = 0; index < orders.length; index += 1) {
      const amount = allocations[index]! / 100;
      const snapshot: LocalOrderSettlementDiscountSnapshot = {
        schemaVersion: 1,
        settlementId,
        promotionId: resolved.promotion.id,
        code: resolved.promotion.code,
        title: resolved.promotion.title,
        badge: resolved.promotion.badge,
        discountType: resolved.promotion.discountType,
        discountValue: resolved.promotion.discountValue,
        amount,
        groupAmount: money(quote.discountTotal),
        groupSubtotal: money(quote.subtotal),
        appliedAt,
        appliedBy: actorUserId,
      };
      transaction.update(orderRefs[index]!, { settlementDiscount: snapshot, updatedAt: appliedAt });
    }
    return {
      settlementId,
      promotionId: quote.promotionId,
      code: quote.code,
      title: quote.title,
      badge: quote.badge,
      discountType: quote.discountType,
      discountValue: quote.discountValue,
      eligibleProductIds: quote.eligibleProductIds,
      eligibleSubtotal: quote.eligibleSubtotal,
      subtotal: quote.subtotal,
      discountTotal: quote.discountTotal,
      total: quote.total,
      appliedAt,
    };
  });
};

export const registerLocalManualTender = async (input: {
  authenticatedUserId: string;
  value: unknown;
  now?: Date;
}): Promise<LocalManualTenderResult> => {
  const request = parseLocalManualTenderInput(input.value);
  const actorUserId = clean(input.authenticatedUserId, 180);
  if (!actorUserId || actorUserId !== request.storeId) throw new Error('LOCAL_MANUAL_TENDER_FORBIDDEN');
  const storeContext = await resolveInPersonOrderStoreContext(request.storeId);
  const now = input.now ?? new Date();
  const createdAt = now.toISOString();
  const attemptId = `manual_${token(`${storeContext.canonicalStoreId}|${request.tableCode}|${request.idempotencyKey}`).slice(0, 44)}`;
  const attemptRef = adminDb.doc(`stores/${storeContext.canonicalStoreId}/manualTenderAttempts/${attemptId}`);
  const orderRefs = request.orderIds.map(orderId => adminDb.doc(`stores/${storeContext.canonicalStoreId}/orders/${orderId}`));
  const paymentQueries = request.orderIds.map(orderId => adminDb.collection(`stores/${storeContext.canonicalStoreId}/payments`).where('orderId', '==', orderId).limit(MAX_PAYMENT_RECORDS_PER_ORDER));

  return adminDb.runTransaction(async transaction => {
    const attemptSnapshot = await transaction.get(attemptRef);
    if (attemptSnapshot.exists) {
      const saved = attemptSnapshot.data() as LocalManualTenderResult;
      if (saved.amount !== request.amount || saved.method !== request.method) throw new Error('LOCAL_MANUAL_TENDER_IDEMPOTENCY_CONFLICT');
      return { ...saved, duplicate: true };
    }
    const orderSnapshots = await Promise.all(orderRefs.map(ref => transaction.get(ref)));
    const paymentSnapshots = await Promise.all(paymentQueries.map(query => transaction.get(query)));
    const orders = orderSnapshots.map((snapshot, index) => assertOrder(request.orderIds[index]!, request.tableCode, snapshot.data()));
    const remainingByOrder: number[] = [];
    for (let index = 0; index < orders.length; index += 1) {
      const payable = summarizeLocalOrderPayable(orders[index]);
      if (payable.hasOperationalPaidQuantity) throw new Error('LOCAL_MANUAL_TENDER_RECONCILIATION_REQUIRED');
      const payments = canonicalPayments(paymentSnapshots[index]!, storeContext.canonicalStoreId, request.orderIds[index]!);
      if (payments.some(payment => payment.status === 'pending')) throw new Error('LOCAL_MANUAL_TENDER_PENDING_PAYMENT');
      const paid = money(payments.filter(payment => isPaymentAuthoritativelyPaid(payment.status)).reduce((sum, payment) => sum + payment.amount, 0));
      remainingByOrder.push(money(Math.max(0, payable.billableAmount - paid)));
    }
    const totalRemaining = money(remainingByOrder.reduce((sum, value) => sum + value, 0));
    if (request.amount > totalRemaining + 0.009) throw new Error('LOCAL_MANUAL_TENDER_AMOUNT_EXCEEDS_OUTSTANDING');

    let left = request.amount;
    const allocations: LocalManualTenderAllocation[] = [];
    for (let index = 0; index < orders.length && left > 0.009; index += 1) {
      const available = remainingByOrder[index]!;
      if (available <= 0) continue;
      const amount = money(Math.min(left, available));
      const order = orders[index]!;
      const orderId = request.orderIds[index]!;
      const suffix = token(`${attemptId}|${orderId}`).slice(0, 44);
      const paymentIntentId = `pi_${suffix}`;
      const paymentId = `pay_${suffix}`;
      const providerPaymentId = `operator_${suffix}`;
      const intentRef = adminDb.doc(`stores/${storeContext.canonicalStoreId}/paymentIntents/${paymentIntentId}`);
      const paymentRef = adminDb.doc(`stores/${storeContext.canonicalStoreId}/payments/${paymentId}`);
      const attestationRef = adminDb.doc(`stores/${storeContext.canonicalStoreId}/paymentAttestations/${paymentId}`);
      const captureId = buildPaymentCaptureEconomicEntryId(paymentId);
      const captureRef = adminDb.doc(storeEconomicLedgerEntryPath(storeContext.canonicalStoreId, captureId));
      const buyerId = clean(order.buyerId, 220);
      if (!buyerId) throw new Error('LOCAL_MANUAL_TENDER_CUSTOMER_REQUIRED');
      const idempotencyKey = `${request.idempotencyKey}:${orderId}`.slice(0, 180);
      const intent = normalizeCanonicalPaymentIntent({
        id: paymentIntentId,
        storeId: storeContext.canonicalStoreId,
        buyerId,
        context: 'table',
        method: request.method,
        status: 'paid',
        amount,
        currency: 'BRL',
        provider: 'operator-recorded',
        providerIntentId: providerPaymentId,
        idempotencyKey,
        target: { kind: 'existing_order', orderId },
        createdAt,
        updatedAt: createdAt,
        expiresAt: createdAt,
      } satisfies ExistingOrderPaymentIntentDocument);
      const payment = normalizeCanonicalPayment({
        id: paymentId,
        storeId: storeContext.canonicalStoreId,
        orderId,
        buyerId,
        paymentIntentId,
        amount,
        currency: 'BRL',
        method: request.method,
        context: 'table',
        status: 'paid',
        provider: 'operator-recorded',
        providerPaymentId,
        idempotencyKey,
        createdAt,
        updatedAt: createdAt,
        paidAt: createdAt,
        refundedAt: '',
      });
      const capture: StoreEconomicLedgerEntry = {
        schemaVersion: STORE_ECONOMIC_LEDGER_SCHEMA_VERSION,
        id: captureId,
        storeId: storeContext.canonicalStoreId,
        kind: 'payment_capture',
        currency: 'BRL',
        amountMinor: brlToMinor(amount),
        paymentId,
        paymentIntentId,
        orderId,
        buyerId,
        paymentContext: 'table',
        paymentMethod: request.method,
        provider: 'operator-recorded',
        providerPaymentId,
        providerEventId: `operator-attestation:${paymentId}`,
        sourceAuthority: 'operator_attestation',
        reversalOfEntryId: '',
        occurredAt: createdAt,
      };
      transaction.set(intentRef, intent);
      transaction.set(paymentRef, payment);
      transaction.set(attestationRef, {
        schemaVersion: 1,
        storeId: storeContext.canonicalStoreId,
        legacyStoreId: request.storeId,
        paymentIntentId,
        paymentId,
        orderId,
        provider: 'operator-recorded',
        providerPaymentId,
        amount,
        currency: 'BRL',
        method: request.method,
        context: 'table',
        actorUserId,
        sourceAuthority: 'operator_attestation',
        bankVerifiedByKyrub: false,
        attestedAt: createdAt,
        acknowledgement: 'operator_recorded_in_person_tender',
      });
      transaction.set(captureRef, capture);
      allocations.push({ orderId, paymentIntentId, paymentId, amount });
      left = money(left - amount);
    }
    if (left > 0.009 || !allocations.length) throw new Error('LOCAL_MANUAL_TENDER_AMOUNT_INVALID');
    const result: LocalManualTenderResult = { duplicate: false, amount: request.amount, method: request.method, createdAt, allocations };
    transaction.set(attemptRef, result);
    return result;
  });
};
''')

# Router: add settlement operations and useful errors.
replace_once(
    'server/attendance/localAttendanceRouter.ts',
    "import { createLocalPaymentIntent } from './localPaymentIntentService.js';",
    "import { createLocalPaymentIntent } from './localPaymentIntentService.js';\nimport { applyLocalTableCoupon, registerLocalManualTender } from './localTableSettlementService.js';",
    'router settlement imports',
)
replace_once(
    'server/attendance/localAttendanceRouter.ts',
    "    message === 'LOCAL_PAYMENT_INTENT_FORBIDDEN' ||\n    message === 'LOCAL_PIX_PROVIDER_FORBIDDEN'",
    "    message === 'LOCAL_PAYMENT_INTENT_FORBIDDEN' ||\n    message === 'LOCAL_TABLE_COUPON_FORBIDDEN' ||\n    message === 'LOCAL_MANUAL_TENDER_FORBIDDEN' ||\n    message === 'LOCAL_PIX_PROVIDER_FORBIDDEN'",
    'router settlement forbidden',
)
replace_once(
    'server/attendance/localAttendanceRouter.ts',
    "  if (\n    message.startsWith('LOCAL_ATTENDANCE_') ||",
    "  if (message === 'LOCAL_TABLE_COUPON_PAYMENT_ALREADY_STARTED') return { status: 409, message: 'O cupom fica congelado depois que um pagamento da conta é iniciado.' };\n  if (message === 'LOCAL_MANUAL_TENDER_PENDING_PAYMENT') return { status: 409, message: 'Há um pagamento pendente. Confirme ou encerre essa tentativa antes de registrar outra forma de pagamento.' };\n  if (message === 'LOCAL_MANUAL_TENDER_AMOUNT_EXCEEDS_OUTSTANDING' || message === 'LOCAL_PAYMENT_INTENT_AMOUNT_EXCEEDS_OUTSTANDING') return { status: 409, message: 'O valor informado é maior que o saldo restante.' };\n  if (\n    message.startsWith('LOCAL_ATTENDANCE_') ||",
    'router settlement specific errors',
)
replace_once(
    'server/attendance/localAttendanceRouter.ts',
    "    message.startsWith('LOCAL_PAYMENT_INTENT_') ||\n    message.startsWith('LOCAL_PENDING_PAYMENT_') ||",
    "    message.startsWith('LOCAL_PAYMENT_INTENT_') ||\n    message.startsWith('LOCAL_TABLE_COUPON_') ||\n    message.startsWith('LOCAL_MANUAL_TENDER_') ||\n    message.startsWith('LOCAL_TABLE_SETTLEMENT_') ||\n    message.startsWith('LOCAL_PENDING_PAYMENT_') ||",
    'router settlement generic errors',
)
route_marker = "  router.post('/payment-intents/mercado-pago-pix', async (request, response) => {"
route_insert = r'''  router.post('/table-coupons/apply', async (request, response) => {
    try {
      const storeId = clean(request.body?.storeId);
      if (!storeId) throw new Error('LOCAL_TABLE_COUPON_INVALID');
      const representation = await requireStoreAuthority({
        authorization: request.get('authorization') ?? '',
        storeId,
      });
      response.status(200).json(await applyLocalTableCoupon({
        authenticatedUserId: representation.authenticatedUserId,
        value: request.body,
      }));
    } catch (error) {
      const mapped = mapError(error);
      response.status(mapped.status).json({ error: mapped.message });
    }
  });

  router.post('/manual-tenders', async (request, response) => {
    try {
      const storeId = clean(request.body?.storeId);
      if (!storeId) throw new Error('LOCAL_MANUAL_TENDER_INVALID');
      const representation = await requireStoreAuthority({
        authorization: request.get('authorization') ?? '',
        storeId,
      });
      const result = await registerLocalManualTender({
        authenticatedUserId: representation.authenticatedUserId,
        value: request.body,
      });
      response.status(result.duplicate ? 200 : 201).json(result);
    } catch (error) {
      const mapped = mapError(error);
      response.status(mapped.status).json({ error: mapped.message });
    }
  });

'''
p = Path('server/attendance/localAttendanceRouter.ts')
text = p.read_text()
if text.count(route_marker) != 1: raise SystemExit('router insertion marker mismatch')
p.write_text(text.replace(route_marker, route_insert + route_marker, 1))

# Client payment helpers.
replace_once(
    'src/utils/localPixCheckout.ts',
    "import type { StorePromotionQuote } from './storePromotions';",
    "import type { StorePromotionQuote } from './storePromotions';\nimport type { LocalManualTenderMethod, LocalManualTenderResult, LocalTableCouponApplyResult } from '../../shared/localTableSettlement';",
    'client settlement types',
)
replace_once(
    'src/utils/localPixCheckout.ts',
    "export const newLocalPaymentAttemptKey = (orderId: string): string => {",
    "export const newLocalManualTenderKey = (tableCode: string): string => {\n  if (!tableCode.trim()) throw new Error('Mesa inválida para registrar o pagamento.');\n  const random = globalThis.crypto?.randomUUID?.();\n  if (!random) throw new Error('Não foi possível criar uma tentativa segura de pagamento.');\n  return `local-manual:${random}`;\n};\n\nexport const newLocalPaymentAttemptKey = (orderId: string): string => {",
    'client manual key',
)
replace_once(
    'src/utils/localPixCheckout.ts',
    "export const loadPendingLocalPayment = async (input: {",
    r'''export const applyLocalTableCoupon = async (input: {
  storeId: string;
  tableCode: string;
  couponCode: string;
  orderIds: string[];
}): Promise<LocalTableCouponApplyResult> =>
  json<LocalTableCouponApplyResult>(
    await authorizedFetch('/api/local-attendance/table-coupons/apply', {
      method: 'POST',
      body: JSON.stringify(input),
    }),
    'Não foi possível aplicar o cupom à conta.'
  );

export const registerLocalManualTender = async (input: {
  storeId: string;
  tableCode: string;
  orderIds: string[];
  method: LocalManualTenderMethod;
  amount: number;
  idempotencyKey: string;
}): Promise<LocalManualTenderResult> =>
  json<LocalManualTenderResult>(
    await authorizedFetch('/api/local-attendance/manual-tenders', {
      method: 'POST',
      body: JSON.stringify(input),
    }),
    'Não foi possível registrar o pagamento presencial.'
  );

export const loadPendingLocalPayment = async (input: {''',
    'client settlement functions',
)
replace_once(
    'src/utils/localPixCheckout.ts',
    "  idempotencyKey: string;\n  couponCode?: string;\n}): Promise<LocalPaymentIntentResult> => {",
    "  idempotencyKey: string;\n  couponCode?: string;\n  amount?: number;\n}): Promise<LocalPaymentIntentResult> => {",
    'client pix amount input',
)
replace_once(
    'src/utils/localPixCheckout.ts',
    "        idempotencyKey: input.idempotencyKey,\n        ...(couponCode ? { couponCode } : {}),",
    "        idempotencyKey: input.idempotencyKey,\n        ...(couponCode ? { couponCode } : {}),\n        ...(input.amount !== undefined ? { amount: input.amount } : {}),",
    'client pix amount payload',
)

# Wrapper shares requested amount with canonical Pix modal and no longer asks the Pix intent to reapply the coupon.
replace_once(
    'src/components/customer/TableServiceWorkspace.tsx',
    "  'onAppliedCouponChange'\n>;",
    "  'onAppliedCouponChange' | 'onPaymentAmountChange'\n>;",
    'wrapper omit callbacks',
)
replace_once(
    'src/components/customer/TableServiceWorkspace.tsx',
    "  const [appliedCouponCode, setAppliedCouponCode] = useState('');",
    "  const [appliedCouponCode, setAppliedCouponCode] = useState('');\n  const [requestedPaymentAmount, setRequestedPaymentAmount] = useState(0);",
    'wrapper amount state',
)
replace_once(
    'src/components/customer/TableServiceWorkspace.tsx',
    "    setAppliedCouponCode('');\n  }, [props.storeId, props.tableCode]);",
    "    setAppliedCouponCode('');\n    setRequestedPaymentAmount(0);\n  }, [props.storeId, props.tableCode]);",
    'wrapper amount reset',
)
replace_once(
    'src/components/customer/TableServiceWorkspace.tsx',
    "    event.preventDefault();\n    event.stopPropagation();\n    setPixCheckoutOpen(true);",
    "    event.preventDefault();\n    event.stopPropagation();\n    if (!Number.isFinite(requestedPaymentAmount) || requestedPaymentAmount <= 0) {\n      props.notify('Informe o valor que será pago antes de escolher Pix.', 'info');\n      return;\n    }\n    setPixCheckoutOpen(true);",
    'wrapper pix amount validation',
)
replace_once(
    'src/components/customer/TableServiceWorkspace.tsx',
    "      orders={activeOrders}\n      couponCode={appliedCouponCode}\n    />",
    "      orders={activeOrders}\n      requestedAmount={requestedPaymentAmount}\n    />",
    'wrapper pix panel amount',
)
replace_once(
    'src/components/customer/TableServiceWorkspace.tsx',
    "          onAppliedCouponChange={setAppliedCouponCode}\n        />",
    "          onAppliedCouponChange={setAppliedCouponCode}\n          onPaymentAmountChange={setRequestedPaymentAmount}\n        />",
    'wrapper legacy callbacks',
)

# Pix panel creates only the requested partial amount. Persisted order discount already defines the authoritative net balance.
replace_once(
    'src/components/store/ServiceLocationFinancialContextPanel.tsx',
    "  couponCode: appliedCouponCode = '',\n}: {\n  storeId: string;\n  orders: CustomerOrder[];\n  couponCode?: string;\n}) {",
    "  requestedAmount,\n}: {\n  storeId: string;\n  orders: CustomerOrder[];\n  requestedAmount?: number;\n}) {",
    'pix panel amount prop',
)
replace_once(
    'src/components/store/ServiceLocationFinancialContextPanel.tsx',
    "    const couponCode = appliedCouponCode.trim();\n    patchPix(order.id, { loading: true, error: '', copied: false, confirmedCredit: false });",
    "    const amount = requestedAmount && requestedAmount > 0 ? Number(requestedAmount.toFixed(2)) : undefined;\n    patchPix(order.id, { loading: true, error: '', copied: false, confirmedCredit: false });",
    'pix panel amount local',
)
replace_once(
    'src/components/store/ServiceLocationFinancialContextPanel.tsx',
    "      if (pending && couponCode) {\n        throw new Error('Já existe uma cobrança pendente para este pedido. O cupom só pode ser definido ao criar uma nova tentativa de pagamento.');\n      }",
    "      if (pending && amount !== undefined && Math.abs(pending.amount - amount) > 0.009) {\n        throw new Error('Já existe uma cobrança Pix pendente com outro valor. Conclua ou encerre essa tentativa antes de criar outra.');\n      }",
    'pix panel pending amount',
)
replace_once(
    'src/components/store/ServiceLocationFinancialContextPanel.tsx',
    "          idempotencyKey: newLocalPaymentAttemptKey(order.id),\n          ...(couponCode ? { couponCode } : {}),",
    "          idempotencyKey: newLocalPaymentAttemptKey(order.id),\n          ...(amount !== undefined ? { amount } : {}),",
    'pix panel create amount',
)
replace_once(
    'src/components/store/ServiceLocationFinancialContextPanel.tsx',
    "        couponCode,\n      });",
    "        couponCode: '',\n      });",
    'pix panel state coupon clear',
)
replace_once(
    'src/components/store/ServiceLocationFinancialContextPanel.tsx',
    "  }, [appliedCouponCode, patchPix, pixByOrder, refresh, storeId]);",
    "  }, [patchPix, pixByOrder, refresh, requestedAmount, storeId]);",
    'pix panel dependencies',
)

# Legacy table account: server financial history, amount field, coupon freeze, and canonical manual tender.
replace_once(
    'src/components/customer/LegacyTableServiceWorkspace.tsx',
    "import { useEffect, useMemo, useState } from 'react';",
    "import { useCallback, useEffect, useMemo, useState } from 'react';",
    'legacy useCallback import',
)
replace_once(
    'src/components/customer/LegacyTableServiceWorkspace.tsx',
    "  registerTablePayment,\n  transferTableItems,",
    "  transferTableItems,",
    'legacy remove register import',
)
replace_once(
    'src/components/customer/LegacyTableServiceWorkspace.tsx',
    "import { quoteLocalCoupon } from '../../utils/localPixCheckout';\nimport type { StorePromotionQuote } from '../../utils/storePromotions';",
    "import {\n  applyLocalTableCoupon,\n  newLocalManualTenderKey,\n  registerLocalManualTender,\n} from '../../utils/localPixCheckout';\nimport { loadLocalOrderFinancialContext } from '../../utils/localOrderFinancialContext';\nimport type { LocalOrderFinancialContext } from '../../../shared/localOrderFinancialContext';\nimport type { LocalTableCouponApplyResult } from '../../../shared/localTableSettlement';",
    'legacy financial imports',
)
replace_once(
    'src/components/customer/LegacyTableServiceWorkspace.tsx',
    "  onAppliedCouponChange?: (couponCode: string) => void;\n}",
    "  onAppliedCouponChange?: (couponCode: string) => void;\n  onPaymentAmountChange?: (amount: number) => void;\n}",
    'legacy amount callback prop',
)
replace_once(
    'src/components/customer/LegacyTableServiceWorkspace.tsx',
    "  onAppliedCouponChange,\n}: TableServiceWorkspaceProps) => {",
    "  onAppliedCouponChange,\n  onPaymentAmountChange,\n}: TableServiceWorkspaceProps) => {",
    'legacy amount callback destructure',
)
replace_once(
    'src/components/customer/LegacyTableServiceWorkspace.tsx',
    "  const [couponQuote, setCouponQuote] = useState<StorePromotionQuote | null>(null);",
    "  const [couponQuote, setCouponQuote] = useState<LocalTableCouponApplyResult | null>(null);\n  const [paymentAmountInput, setPaymentAmountInput] = useState('');\n  const [financialContexts, setFinancialContexts] = useState<Record<string, LocalOrderFinancialContext>>({});",
    'legacy financial states',
)
replace_once(
    'src/components/customer/LegacyTableServiceWorkspace.tsx',
    "    setCouponQuote(null);\n    onAppliedCouponChange?.('');",
    "    setCouponQuote(null);\n    setPaymentAmountInput('');\n    setFinancialContexts({});\n    onAppliedCouponChange?.('');\n    onPaymentAmountChange?.(0);",
    'legacy reset financial state',
)
replace_once(
    'src/components/customer/LegacyTableServiceWorkspace.tsx',
    "  }, [tableCode, onAppliedCouponChange]);\n\n  useEffect(() => {\n    setCouponQuote(null);\n    onAppliedCouponChange?.('');\n  }, [paymentSelections, onAppliedCouponChange]);",
    "  }, [tableCode, onAppliedCouponChange, onPaymentAmountChange]);",
    'legacy remove selection coupon reset',
)
# Insert financial refresh after activeOrders memo.
active_marker = "  const openLines = useMemo(\n    () => getTableOpenLines(orders, tableCode),"
financial_block = r'''  const refreshFinancialContexts = useCallback(async (quiet = false): Promise<void> => {
    if (!activeOrders.length) {
      setFinancialContexts({});
      return;
    }
    try {
      const next = await Promise.all(activeOrders.map(order =>
        loadLocalOrderFinancialContext({ storeId, orderId: order.id })
      ));
      setFinancialContexts(Object.fromEntries(next.map(context => [context.orderId, context])));
    } catch (error) {
      if (!quiet) notify(
        error instanceof Error ? error.message : 'Não foi possível atualizar o histórico de pagamentos.',
        'error'
      );
    }
  }, [activeOrders, notify, storeId]);

  useEffect(() => {
    if (view !== 'account') return;
    void refreshFinancialContexts();
    const timer = window.setInterval(() => void refreshFinancialContexts(true), 5000);
    return () => window.clearInterval(timer);
  }, [refreshFinancialContexts, view]);

'''
p = Path('src/components/customer/LegacyTableServiceWorkspace.tsx')
text = p.read_text()
if text.count(active_marker) != 1: raise SystemExit('legacy financial insertion marker mismatch')
p.write_text(text.replace(active_marker, financial_block + active_marker, 1))
# Replace selected/coupon financial arithmetic with canonical aggregate and history.
replace_once(
    'src/components/customer/LegacyTableServiceWorkspace.tsx',
    "  const payablePaymentTotal = couponQuote?.total ?? selectedPaymentTotal;",
    r'''  const loadedFinancialContexts = activeOrders.map(order => financialContexts[order.id]).filter(Boolean) as LocalOrderFinancialContext[];
  const hasCompleteFinancialSnapshot = activeOrders.length > 0 && loadedFinancialContexts.length === activeOrders.length;
  const financialOutstandingTotal = hasCompleteFinancialSnapshot
    ? Number(loadedFinancialContexts.reduce((sum, context) => sum + context.canonicalProjection.outstandingAmount, 0).toFixed(2))
    : Number((couponQuote?.total ?? selectedPaymentTotal).toFixed(2));
  const paymentHistory = loadedFinancialContexts
    .flatMap(context => context.paymentHistory.map(payment => ({ ...payment, orderId: context.orderId })))
    .sort((a, b) => (b.paidAt || b.createdAt).localeCompare(a.paidAt || a.createdAt));
  const discountHistory = Array.from(new Map(
    loadedFinancialContexts
      .filter(context => context.discount)
      .map(context => [context.discount!.settlementId, context.discount!] as const)
  ).values());
  const hasPaymentActivity = paymentHistory.some(payment => payment.status === 'pending' || ['paid', 'refund_requested', 'refund_processing', 'refund_failed', 'chargeback_reversed'].includes(payment.status));
  const paymentAmount = (() => {
    const normalized = paymentAmountInput.replace(/\s/g, '').replace('R$', '').replace('.', '').replace(',', '.');
    const value = Number(normalized);
    return Number.isFinite(value) && value > 0 ? Number(value.toFixed(2)) : 0;
  })();''',
    'legacy canonical financial arithmetic',
)
# Inform wrapper whenever amount changes.
insert_after_amount = "  const selectedTransferTotal = openLines.reduce("
p = Path('src/components/customer/LegacyTableServiceWorkspace.tsx')
text = p.read_text()
if text.count(insert_after_amount) != 1: raise SystemExit('amount callback marker mismatch')
callback = "  useEffect(() => {\n    onPaymentAmountChange?.(paymentAmount);\n  }, [onPaymentAmountChange, paymentAmount]);\n\n"
p.write_text(text.replace(insert_after_amount, callback + insert_after_amount, 1))
# Coupon apply now persists against whole active table before any payment begins.
old_coupon_handler_start = "  const assertCouponMatchesSelection = (quote: StorePromotionQuote): void => {"
text = Path('src/components/customer/LegacyTableServiceWorkspace.tsx').read_text()
start = text.index(old_coupon_handler_start)
end = text.index("  const handleRegisterPayment = async (): Promise<void> => {", start)
new_coupon_handler = r'''  const handleApplyCoupon = async (): Promise<void> => {
    const code = couponCode.trim();
    if (!code) {
      notify('Digite o código do cupom.', 'info');
      return;
    }
    if (!activeOrders.length) {
      notify('Não há pedido ativo nesta mesa para aplicar o cupom.', 'info');
      return;
    }
    if (hasPaymentActivity) {
      notify('O cupom fica congelado depois que um pagamento da conta é iniciado.', 'info');
      return;
    }

    setBusyAction('coupon');
    try {
      const quote = await applyLocalTableCoupon({
        storeId,
        tableCode,
        couponCode: code,
        orderIds: activeOrders.map(order => order.id),
      });
      setCouponCode(quote.code);
      setCouponQuote(quote);
      onAppliedCouponChange?.(quote.code);
      await refreshFinancialContexts(true);
      setPaymentAmountInput(quote.total.toFixed(2).replace('.', ','));
      notify(
        `Cupom ${quote.code} aplicado. Saldo a pagar: ${formatCurrency(quote.total)}.`,
        'success'
      );
    } catch (error) {
      notify(
        error instanceof Error ? error.message : 'Não foi possível aplicar o cupom.',
        'error'
      );
    } finally {
      setBusyAction('');
    }
  };

'''
Path('src/components/customer/LegacyTableServiceWorkspace.tsx').write_text(text[:start] + new_coupon_handler + text[end:])
# Replace payment handler body wholesale up to exclude handler.
p = Path('src/components/customer/LegacyTableServiceWorkspace.tsx')
text = p.read_text()
start = text.index("  const handleRegisterPayment = async (): Promise<void> => {")
end = text.index("  const handleExcludeItem = async", start)
new_payment_handler = r'''  const handleRegisterPayment = async (): Promise<void> => {
    if (paymentMethod === 'pix') return;
    if (!activeOrders.length) {
      notify('Não há pedido ativo nesta mesa.', 'info');
      return;
    }
    if (paymentAmount <= 0) {
      notify('Informe o valor que será pago agora.', 'info');
      return;
    }
    if (paymentAmount > financialOutstandingTotal + 0.009) {
      notify('O valor informado é maior que o saldo restante.', 'error');
      return;
    }

    setBusyAction('payment');
    try {
      const result = await registerLocalManualTender({
        storeId,
        tableCode,
        orderIds: activeOrders.map(order => order.id),
        method: paymentMethod,
        amount: paymentAmount,
        idempotencyKey: newLocalManualTenderKey(tableCode),
      });
      setPaymentAmountInput('');
      await refreshFinancialContexts(true);
      notify(
        `${formatCurrency(result.amount)} registrado em ${getTablePaymentMethodLabel(paymentMethod)}.`,
        'success'
      );
    } catch (error) {
      notify(
        error instanceof Error ? error.message : 'Não foi possível registrar o pagamento.',
        'error'
      );
    } finally {
      setBusyAction('');
    }
  };

'''
p.write_text(text[:start] + new_payment_handler + text[end:])
# Header saldo uses canonical financial remainder when available.
replace_once(
    'src/components/customer/LegacyTableServiceWorkspace.tsx',
    "                  {formatCurrency(outstandingTotal)}",
    "                  {formatCurrency(hasCompleteFinancialSnapshot ? financialOutstandingTotal : outstandingTotal)}",
    'legacy header canonical balance',
)
# Replace sidebar summary/coupon/payment controls segment.
p = Path('src/components/customer/LegacyTableServiceWorkspace.tsx')
text = p.read_text()
start = text.index('                  <div className="space-y-2 rounded-2xl bg-slate-900 p-3 text-xs">')
end = text.index('                  <p className="text-[9px] leading-relaxed text-slate-600">', start)
new_sidebar = r'''                  <div className="space-y-2 rounded-2xl bg-slate-900 p-3 text-xs">
                    <div className="flex justify-between text-slate-500">
                      <span>Pedidos ativos</span>
                      <span>{activeOrders.length}</span>
                    </div>
                    <div className="flex justify-between text-slate-500">
                      <span>Saldo da mesa</span>
                      <span>{formatCurrency(hasCompleteFinancialSnapshot ? loadedFinancialContexts.reduce((sum, context) => sum + context.expectedAmount, 0) : outstandingTotal)}</span>
                    </div>
                    <div className="flex justify-between border-t border-slate-800 pt-2 font-black text-white">
                      <span>Saldo a pagar</span>
                      <span>{formatCurrency(financialOutstandingTotal)}</span>
                    </div>
                  </div>

                  <div className="rounded-2xl border border-slate-800 bg-slate-900/70 p-3">
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-[10px] font-black uppercase text-slate-200">Histórico de pagamentos</span>
                      <span className="text-[8px] text-slate-600">{paymentHistory.length + discountHistory.length} movimento(s)</span>
                    </div>
                    {paymentHistory.length === 0 && discountHistory.length === 0 ? (
                      <p className="mt-2 text-[9px] text-slate-600">Nenhum pagamento ou desconto registrado.</p>
                    ) : (
                      <div className="mt-2 space-y-2">
                        {discountHistory.map(discount => (
                          <div key={discount.settlementId} className="flex items-start justify-between gap-3 rounded-xl border border-violet-500/15 bg-violet-500/[0.05] px-2.5 py-2 text-[9px]">
                            <div>
                              <strong className="text-violet-200">Cupom {discount.code}</strong>
                              <span className="mt-0.5 block text-violet-200/55">Desconto aplicado · {new Date(discount.appliedAt).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}</span>
                            </div>
                            <strong className="font-mono text-violet-200">− {formatCurrency(discount.groupAmount)}</strong>
                          </div>
                        ))}
                        {paymentHistory.map(payment => (
                          <div key={payment.paymentId} className="flex items-start justify-between gap-3 rounded-xl border border-slate-800 bg-slate-950/70 px-2.5 py-2 text-[9px]">
                            <div>
                              <strong className="text-slate-200">{getTablePaymentMethodLabel(payment.method as TablePaymentMethod)}</strong>
                              <span className={`mt-0.5 block ${payment.status === 'pending' ? 'text-amber-300' : payment.status === 'paid' ? 'text-emerald-300' : 'text-slate-500'}`}>
                                {payment.status === 'pending' ? 'Aguardando confirmação' : payment.status === 'paid' ? 'Confirmado' : payment.status}
                                {' · '}{new Date(payment.paidAt || payment.createdAt).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}
                              </span>
                            </div>
                            <strong className="font-mono text-slate-100">{formatCurrency(payment.amount)}</strong>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>

                  <div className="rounded-2xl border border-emerald-500/20 bg-emerald-500/[0.04] p-3">
                    <div className="flex items-center justify-between gap-2">
                      <label htmlFor="staff-table-payment-amount" className="text-[10px] font-black text-emerald-100">Valor a pagar agora</label>
                      <button
                        type="button"
                        onClick={() => setPaymentAmountInput(financialOutstandingTotal.toFixed(2).replace('.', ','))}
                        disabled={financialOutstandingTotal <= 0}
                        className="text-[8px] font-black uppercase text-emerald-300 disabled:opacity-40"
                      >
                        Usar saldo restante
                      </button>
                    </div>
                    <div className="mt-2 flex items-center rounded-xl border border-slate-800 bg-slate-950 px-3">
                      <span className="mr-2 text-xs font-black text-slate-500">R$</span>
                      <input
                        id="staff-table-payment-amount"
                        type="text"
                        inputMode="decimal"
                        value={paymentAmountInput}
                        onChange={event => setPaymentAmountInput(event.target.value.replace(/[^0-9,\.]/g, ''))}
                        placeholder="0,00"
                        className="min-h-11 min-w-0 flex-1 bg-transparent font-mono text-sm font-black text-white outline-none placeholder:text-slate-700"
                      />
                    </div>
                    {paymentAmount > financialOutstandingTotal + 0.009 && (
                      <p className="mt-2 text-[9px] font-semibold text-red-300">O valor não pode ultrapassar o saldo a pagar.</p>
                    )}
                  </div>

                  <div className="rounded-2xl border border-violet-500/20 bg-violet-500/[0.05] p-3">
                    <label htmlFor="staff-table-coupon-code" className="flex items-center gap-2 text-[10px] font-black text-violet-100">
                      <TicketPercent className="h-4 w-4" />
                      Cupom de desconto
                    </label>
                    <div className="mt-2 flex gap-2">
                      <input
                        id="staff-table-coupon-code"
                        type="text"
                        value={couponCode}
                        maxLength={48}
                        autoComplete="off"
                        spellCheck={false}
                        disabled={hasPaymentActivity}
                        onChange={event => setCouponCode(event.target.value.toUpperCase())}
                        placeholder={hasPaymentActivity ? 'Cupom congelado após início do pagamento' : 'Digite o cupom'}
                        className="min-h-10 min-w-0 flex-1 rounded-xl border border-slate-800 bg-slate-900 px-3 text-xs font-bold uppercase text-white outline-none placeholder:normal-case placeholder:text-slate-600 focus:border-violet-400 disabled:opacity-50"
                      />
                      <button
                        type="button"
                        onClick={() => void handleApplyCoupon()}
                        disabled={!couponCode.trim() || activeOrders.length === 0 || hasPaymentActivity || busyAction === 'coupon' || busyAction === 'payment'}
                        className="min-h-10 rounded-xl bg-violet-500 px-3 text-[9px] font-black uppercase text-white disabled:opacity-40"
                      >
                        {busyAction === 'coupon' ? 'Aplicando...' : 'Aplicar'}
                      </button>
                    </div>
                    {couponQuote && (
                      <p className="mt-2 text-[9px] font-semibold text-violet-200">
                        {couponQuote.title} · desconto de {formatCurrency(couponQuote.discountTotal)} aplicado.
                      </p>
                    )}
                    {hasPaymentActivity && (
                      <p className="mt-2 text-[8px] leading-relaxed text-slate-500">O desconto fica congelado depois do primeiro pagamento iniciado para preservar a conciliação.</p>
                    )}
                  </div>

                  <div className="grid grid-cols-2 gap-2">
                    {(['cash', 'pix', 'card', 'other'] as TablePaymentMethod[]).map(method => (
                      <button
                        key={method}
                        type="button"
                        disabled={paymentAmount <= 0 || paymentAmount > financialOutstandingTotal + 0.009}
                        onClick={() => setPaymentMethod(method)}
                        className={`rounded-xl border px-3 py-2 text-[9px] font-black uppercase disabled:opacity-40 ${
                          paymentMethod === method
                            ? 'border-orange-500 bg-orange-500 text-slate-950'
                            : 'border-slate-800 bg-slate-900 text-slate-500'
                        }`}
                      >
                        {getTablePaymentMethodLabel(method)}
                      </button>
                    ))}
                  </div>
'''
p.write_text(text[:start] + new_sidebar + text[end:])
# Payment button no longer depends on item selection and Pix is handled by wrapper.
replace_once(
    'src/components/customer/LegacyTableServiceWorkspace.tsx',
    "                    disabled={paymentSelectionArray.length === 0 || busyAction === 'payment'}",
    "                    disabled={paymentMethod === 'pix' || paymentAmount <= 0 || paymentAmount > financialOutstandingTotal + 0.009 || busyAction === 'payment'}",
    'legacy payment button disabled',
)
replace_once(
    'src/components/customer/LegacyTableServiceWorkspace.tsx',
    "                    {busyAction === 'payment' ? 'Registrando...' : 'Registrar pagamento'}",
    "                    {busyAction === 'payment' ? 'Registrando...' : paymentMethod === 'pix' ? 'Use o botão Pix acima' : 'Registrar pagamento'}",
    'legacy payment button label',
)

# Focused source/contract tests.
Path('tests/table-split-payments.test.ts').write_text(r'''import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { describe, test } from 'node:test';
import { parseLocalManualTenderInput, parseLocalTableCouponApplyInput } from '../shared/localTableSettlement';
import { parseLocalPaymentIntentCreateInput } from '../shared/localPaymentIntent';
import { summarizeLocalOrderPayable } from '../server/attendance/localOrderPayable';

describe('split table payments', () => {
  test('manual tender parser accepts a positive non-Pix partial amount', () => {
    assert.deepEqual(parseLocalManualTenderInput({ storeId: 's1', tableCode: '5', orderIds: ['o1'], method: 'cash', amount: 10, idempotencyKey: 'k1' }), { storeId: 's1', tableCode: '5', orderIds: ['o1'], method: 'cash', amount: 10, idempotencyKey: 'k1' });
    assert.throws(() => parseLocalManualTenderInput({ storeId: 's1', tableCode: '5', orderIds: ['o1'], method: 'pix', amount: 10, idempotencyKey: 'k1' }), /METHOD_INVALID/);
  });

  test('Pix intent parser accepts an explicit partial amount', () => {
    assert.equal(parseLocalPaymentIntentCreateInput({ storeId: 's1', orderId: 'o1', idempotencyKey: 'k1', amount: 7.5 }).amount, 7.5);
  });

  test('payable subtracts voided quantity and persisted coupon without pretending discount is cash', () => {
    const summary = summarizeLocalOrderPayable({
      items: [{ price: 29.5, quantity: 2, paidQuantity: 0, transferredQuantity: 0, voidedQuantity: 1 }],
      settlementDiscount: { amount: 5 },
    });
    assert.equal(summary.grossBillableAmount, 29.5);
    assert.equal(summary.discountAmount, 5);
    assert.equal(summary.billableAmount, 24.5);
    assert.equal(summary.voidedAmount, 29.5);
  });

  test('coupon application is table/order scoped', () => {
    assert.deepEqual(parseLocalTableCouponApplyInput({ storeId: 's1', tableCode: '5', couponCode: ' promo ', orderIds: ['o1'] }), { storeId: 's1', tableCode: '5', couponCode: 'PROMO', orderIds: ['o1'] });
  });

  test('UI exposes history, amount field and remaining-balance shortcut', () => {
    const ui = readFileSync('src/components/customer/LegacyTableServiceWorkspace.tsx', 'utf8');
    assert.match(ui, /Histórico de pagamentos/);
    assert.match(ui, /Valor a pagar agora/);
    assert.match(ui, /Usar saldo restante/);
    assert.match(ui, /Cupom \{discount\.code\}/);
    assert.match(ui, /Aguardando confirmação/);
  });

  test('Pix providers allow partial intent not exceeding authoritative remaining balance', () => {
    for (const path of [
      'server/attendance/localMercadoPagoPixService.ts',
      'server/attendance/localStoreOwnedPixService.ts',
      'server/attendance/localStoreOwnedPixConfirmationService.ts',
    ]) {
      const source = readFileSync(path, 'utf8');
      assert.match(source, /> remaining \+ 0\.009/);
    }
  });

  test('manual tender creates canonical payment evidence and operator attestation', () => {
    const service = readFileSync('server/attendance/localTableSettlementService.ts', 'utf8');
    assert.match(service, /status: 'paid'/);
    assert.match(service, /sourceAuthority: 'operator_attestation'/);
    assert.match(service, /payment_capture/);
    assert.doesNotMatch(service, /paidQuantity/);
  });
});
''')
