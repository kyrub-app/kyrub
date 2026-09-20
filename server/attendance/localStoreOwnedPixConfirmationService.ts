import type { DocumentData } from 'firebase-admin/firestore';
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
import {
  STORE_ECONOMIC_LEDGER_SCHEMA_VERSION,
  brlToMinor,
  buildPaymentCaptureEconomicEntryId,
  storeEconomicLedgerEntryPath,
} from '../../shared/storeEconomicLedger.js';
import { classifyCompatiblePaymentRecord } from '../payments/paymentRecordCompatibility.js';
import { resolveInPersonOrderStoreContext } from './inPersonOrderService.js';
import { summarizeLocalOrderPayable } from './localOrderPayable.js';

const MAX_PAYMENT_RECORDS_PER_ORDER = 50;
const PROVIDER = 'store-pix' as const;

const clean = (value: unknown, max = 254): string =>
  typeof value === 'string' ? value.trim().slice(0, max) : '';

const cleanId = (value: unknown, max: number): string => {
  const id = clean(value, max);
  if (!id || id.includes('/') || id.includes('..')) {
    throw new Error('LOCAL_STORE_PIX_CONFIRM_TARGET_INVALID');
  }
  return id;
};

const parseConfirmation = (value: unknown) => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('LOCAL_STORE_PIX_CONFIRM_INVALID');
  }
  const record = value as Record<string, unknown>;
  const allowed = new Set([
    'storeId',
    'paymentIntentId',
    'paymentId',
    'providerPaymentId',
    'confirmedCredit',
  ]);
  if (Object.keys(record).some(field => !allowed.has(field))) {
    throw new Error('LOCAL_STORE_PIX_CONFIRM_UNSUPPORTED_FIELD');
  }
  if (record.confirmedCredit !== true) {
    throw new Error('LOCAL_STORE_PIX_CONFIRM_EXPLICIT_ACK_REQUIRED');
  }
  return {
    storeId: cleanId(record.storeId, 180),
    paymentIntentId: cleanId(record.paymentIntentId, 220),
    paymentId: cleanId(record.paymentId, 220),
    providerPaymentId: cleanId(record.providerPaymentId, 220),
  };
};

const contextForOrder = (order: DocumentData): 'table' | 'pos' => {
  const location = parseServiceLocationSnapshot(order.serviceLocation);
  if (location) return location.kind === 'table' ? 'table' : 'pos';
  if (clean(order.tableCode, 80)) return 'table';
  throw new Error('LOCAL_STORE_PIX_CONFIRM_SERVICE_LOCATION_REQUIRED');
};

const assertPair = (input: {
  intent: ExistingOrderCanonicalPaymentIntent;
  payment: CanonicalPayment;
  canonicalStoreId: string;
  paymentIntentId: string;
  paymentId: string;
  providerPaymentId: string;
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
    input.intent.idempotencyKey !== input.payment.idempotencyKey ||
    input.intent.provider !== PROVIDER ||
    input.payment.provider !== PROVIDER ||
    input.intent.providerIntentId !== input.providerPaymentId ||
    input.payment.providerPaymentId !== input.providerPaymentId
  ) {
    throw new Error('LOCAL_STORE_PIX_CONFIRM_PAYMENT_PAIR_MISMATCH');
  }
};

const attestationPath = (storeId: string, paymentId: string): string =>
  `stores/${storeId}/paymentAttestations/${paymentId}`;

export interface LocalStoreOwnedPixConfirmationResult {
  confirmed: true;
  duplicate: boolean;
  paymentIntentId: string;
  paymentId: string;
  orderId: string;
  amount: number;
  currency: 'BRL';
  provider: 'store-pix';
  providerPaymentId: string;
  sourceAuthority: 'operator_attestation';
  bankVerifiedByKyrub: false;
  attestedAt: string;
}

export const confirmStoreOwnedPixLocalPayment = async (input: {
  authenticatedUserId: string;
  value: unknown;
  now?: Date;
}): Promise<LocalStoreOwnedPixConfirmationResult> => {
  const request = parseConfirmation(input.value);
  const actorUserId = clean(input.authenticatedUserId, 180);
  if (!actorUserId || actorUserId !== request.storeId) {
    throw new Error('LOCAL_STORE_PIX_CONFIRM_FORBIDDEN');
  }
  const storeContext = await resolveInPersonOrderStoreContext(request.storeId);
  const now = input.now ?? new Date();
  if (Number.isNaN(now.getTime())) throw new Error('LOCAL_STORE_PIX_CONFIRM_TIME_INVALID');
  const attestedAt = now.toISOString();

  return adminDb.runTransaction(async transaction => {
    const intentRef = adminDb.doc(
      `stores/${storeContext.canonicalStoreId}/paymentIntents/${request.paymentIntentId}`
    );
    const paymentRef = adminDb.doc(
      `stores/${storeContext.canonicalStoreId}/payments/${request.paymentId}`
    );
    const attestationRef = adminDb.doc(
      attestationPath(storeContext.canonicalStoreId, request.paymentId)
    );
    const captureId = buildPaymentCaptureEconomicEntryId(request.paymentId);
    const captureRef = adminDb.doc(
      storeEconomicLedgerEntryPath(storeContext.canonicalStoreId, captureId)
    );
    const [intentSnapshot, paymentSnapshot, attestationSnapshot, captureSnapshot] =
      await Promise.all([
        transaction.get(intentRef),
        transaction.get(paymentRef),
        transaction.get(attestationRef),
        transaction.get(captureRef),
      ]);
    if (!intentSnapshot.exists || !paymentSnapshot.exists) {
      throw new Error('LOCAL_STORE_PIX_CONFIRM_PAYMENT_STATE_MISSING');
    }
    const intent = normalizeCanonicalPaymentIntent(
      intentSnapshot.data() as ExistingOrderPaymentIntentDocument
    );
    const payment = normalizeCanonicalPayment(
      paymentSnapshot.data() as CanonicalPayment
    );
    assertPair({
      intent,
      payment,
      canonicalStoreId: storeContext.canonicalStoreId,
      paymentIntentId: request.paymentIntentId,
      paymentId: request.paymentId,
      providerPaymentId: request.providerPaymentId,
    });

    if (payment.status === 'paid' && intent.status === 'paid') {
      const audit = attestationSnapshot.data() as Record<string, unknown> | undefined;
      const capture = captureSnapshot.data() as Record<string, unknown> | undefined;
      if (
        !attestationSnapshot.exists ||
        !captureSnapshot.exists ||
        audit?.sourceAuthority !== 'operator_attestation' ||
        audit?.actorUserId !== actorUserId ||
        audit?.providerPaymentId !== request.providerPaymentId ||
        capture?.sourceAuthority !== 'operator_attestation' ||
        capture?.paymentId !== payment.id ||
        capture?.providerPaymentId !== request.providerPaymentId
      ) {
        throw new Error('LOCAL_STORE_PIX_CONFIRM_RECONCILIATION_REQUIRED');
      }
      return {
        confirmed: true,
        duplicate: true,
        paymentIntentId: intent.id,
        paymentId: payment.id,
        orderId: payment.orderId,
        amount: payment.amount,
        currency: 'BRL',
        provider: PROVIDER,
        providerPaymentId: request.providerPaymentId,
        sourceAuthority: 'operator_attestation',
        bankVerifiedByKyrub: false,
        attestedAt: clean(audit.attestedAt) || payment.paidAt,
      };
    }
    if (payment.status !== 'pending' || intent.status !== 'pending') {
      throw new Error('LOCAL_STORE_PIX_CONFIRM_PAYMENT_NOT_PENDING');
    }
    if (attestationSnapshot.exists || captureSnapshot.exists) {
      throw new Error('LOCAL_STORE_PIX_CONFIRM_RECONCILIATION_REQUIRED');
    }
    if (Date.parse(intent.expiresAt) <= now.getTime()) {
      throw new Error('LOCAL_STORE_PIX_CONFIRM_INTENT_EXPIRED');
    }

    const orderRef = adminDb.doc(
      `stores/${storeContext.canonicalStoreId}/orders/${intent.target.orderId}`
    );
    const paymentQuery = adminDb
      .collection(`stores/${storeContext.canonicalStoreId}/payments`)
      .where('orderId', '==', intent.target.orderId)
      .limit(MAX_PAYMENT_RECORDS_PER_ORDER);
    const [orderSnapshot, orderPayments] = await Promise.all([
      transaction.get(orderRef),
      transaction.get(paymentQuery),
    ]);
    if (!orderSnapshot.exists) throw new Error('LOCAL_STORE_PIX_CONFIRM_ORDER_NOT_FOUND');
    const order = orderSnapshot.data() as DocumentData;
    if (
      clean(order.id, 220) !== intent.target.orderId ||
      order.fulfillmentType !== 'dine_in' ||
      order.status === 'rejected' ||
      order.status === 'cancelled'
    ) {
      throw new Error('LOCAL_STORE_PIX_CONFIRM_ORDER_NOT_ELIGIBLE');
    }
    if (clean(order.buyerId, 220) !== intent.buyerId) {
      throw new Error('LOCAL_STORE_PIX_CONFIRM_BUYER_CHANGED');
    }
    if (contextForOrder(order) !== intent.context) {
      throw new Error('LOCAL_STORE_PIX_CONFIRM_CONTEXT_CHANGED');
    }
    let payable;
    try {
      payable = summarizeLocalOrderPayable(order);
    } catch {
      throw new Error('LOCAL_STORE_PIX_CONFIRM_ORDER_TOTAL_INVALID');
    }
    if (payable.hasOperationalPaidQuantity) {
      throw new Error('LOCAL_STORE_PIX_CONFIRM_RECONCILIATION_REQUIRED');
    }
    if (orderPayments.size >= MAX_PAYMENT_RECORDS_PER_ORDER) {
      throw new Error('LOCAL_STORE_PIX_CONFIRM_RECONCILIATION_REQUIRED');
    }

    let currentFound = false;
    let otherPaidAmount = 0;
    for (const document of orderPayments.docs) {
      const compatible = classifyCompatiblePaymentRecord(
        document.data(),
        storeContext.canonicalStoreId
      );
      if (compatible.kind === 'legacy_table_payment_mirror') continue;
      const candidate = compatible.payment;
      if (candidate.orderId !== intent.target.orderId || candidate.context !== intent.context) {
        throw new Error('LOCAL_STORE_PIX_CONFIRM_RECONCILIATION_REQUIRED');
      }
      if (candidate.id === payment.id) {
        currentFound = true;
        continue;
      }
      if (candidate.status === 'pending') {
        throw new Error('LOCAL_STORE_PIX_CONFIRM_OTHER_PAYMENT_PENDING');
      }
      if (isPaymentAuthoritativelyPaid(candidate.status)) {
        otherPaidAmount += candidate.amount;
      }
    }
    if (!currentFound) throw new Error('LOCAL_STORE_PIX_CONFIRM_PAYMENT_NOT_INDEXED');
    const remaining = Number((payable.billableAmount - otherPaidAmount).toFixed(2));
    if (Math.abs(remaining - payment.amount) > 0.009) {
      throw new Error('LOCAL_STORE_PIX_CONFIRM_INTENT_STALE');
    }

    const audit = {
      schemaVersion: 1,
      storeId: storeContext.canonicalStoreId,
      legacyStoreId: request.storeId,
      paymentIntentId: intent.id,
      paymentId: payment.id,
      orderId: payment.orderId,
      provider: PROVIDER,
      providerPaymentId: request.providerPaymentId,
      amount: payment.amount,
      currency: 'BRL',
      method: 'pix',
      context: payment.context,
      actorUserId,
      sourceAuthority: 'operator_attestation',
      bankVerifiedByKyrub: false,
      attestedAt,
      acknowledgement: 'operator_confirmed_credit_in_receiving_account',
    } as const;
    const capture = {
      schemaVersion: STORE_ECONOMIC_LEDGER_SCHEMA_VERSION,
      id: captureId,
      storeId: storeContext.canonicalStoreId,
      kind: 'payment_capture',
      currency: 'BRL',
      amountMinor: brlToMinor(payment.amount),
      paymentId: payment.id,
      paymentIntentId: intent.id,
      orderId: payment.orderId,
      buyerId: payment.buyerId,
      paymentContext: payment.context,
      paymentMethod: payment.method,
      provider: PROVIDER,
      providerPaymentId: request.providerPaymentId,
      providerEventId: `operator-attestation:${payment.id}`,
      sourceAuthority: 'operator_attestation',
      reversalOfEntryId: '',
      occurredAt: attestedAt,
    } as const;

    transaction.set(attestationRef, audit);
    transaction.set(captureRef, capture);
    transaction.update(intentRef, {
      status: 'paid',
      updatedAt: attestedAt,
    });
    transaction.update(paymentRef, {
      status: 'paid',
      paidAt: attestedAt,
      updatedAt: attestedAt,
    });

    return {
      confirmed: true,
      duplicate: false,
      paymentIntentId: intent.id,
      paymentId: payment.id,
      orderId: payment.orderId,
      amount: payment.amount,
      currency: 'BRL',
      provider: PROVIDER,
      providerPaymentId: request.providerPaymentId,
      sourceAuthority: 'operator_attestation',
      bankVerifiedByKyrub: false,
      attestedAt,
    };
  });
};
