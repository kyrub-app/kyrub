import { createHash } from 'node:crypto';
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
import type { StoreOwnedPixConfiguration } from '../../shared/storeOwnedPix.js';
import { parseServiceLocationSnapshot } from '../../shared/serviceLocation.js';
import { parseLocalPixProviderAttachInput } from '../../shared/localPaymentProvider.js';
import { classifyCompatiblePaymentRecord } from '../payments/paymentRecordCompatibility.js';
import { loadStoreOwnedPixConfiguration } from '../integrations/storeOwnedPixSecretStore.js';
import {
  decryptIntegrationSecret,
  encryptIntegrationSecret,
  getIntegrationMasterKey,
} from '../integrations/secretVault.js';
import { buildStoreOwnedPixBrCode, createPixQrCodeDataUri } from '../payments/pixBrCode.js';
import { resolveInPersonOrderStoreContext } from './inPersonOrderService.js';
import { summarizeLocalOrderPayable } from './localOrderPayable.js';
import {
  STORE_OWNED_PIX_PROVIDER,
  parseStoreOwnedPixPaymentBinding,
  storeOwnedPixPaymentBindingAad,
  storeOwnedPixPaymentBindingPath,
} from './storeOwnedPixPaymentBinding.js';

const MAX_PAYMENT_RECORDS_PER_ORDER = 50;
const PROVIDER = STORE_OWNED_PIX_PROVIDER;

const clean = (value: unknown, max = 254): string =>
  typeof value === 'string' ? value.trim().slice(0, max) : '';

const paymentContextForOrder = (order: DocumentData): 'table' | 'pos' => {
  const location = parseServiceLocationSnapshot(order.serviceLocation);
  if (location) return location.kind === 'table' ? 'table' : 'pos';
  if (clean(order.tableCode, 80)) return 'table';
  throw new Error('LOCAL_STORE_PIX_SERVICE_LOCATION_REQUIRED');
};

const assertPair = (input: {
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
  ) throw new Error('LOCAL_STORE_PIX_PAYMENT_PAIR_MISMATCH');
};

const boundProviderPaymentId = (
  intent: ExistingOrderCanonicalPaymentIntent,
  payment: CanonicalPayment
): string => {
  const intentProvider = clean(intent.provider, 80);
  const paymentProvider = clean(payment.provider, 80);
  const intentProviderId = clean(intent.providerIntentId, 220);
  const paymentProviderId = clean(payment.providerPaymentId, 220);
  const hasBinding = Boolean(intentProvider || paymentProvider || intentProviderId || paymentProviderId);
  if (!hasBinding) return '';
  if (
    intentProvider !== PROVIDER || paymentProvider !== PROVIDER ||
    !intentProviderId || !paymentProviderId || intentProviderId !== paymentProviderId
  ) throw new Error('LOCAL_STORE_PIX_BINDING_CONFLICT');
  return intentProviderId;
};

const providerPaymentIdFor = (canonicalStoreId: string, paymentId: string): string =>
  `storepix_${createHash('sha256')
    .update(`${canonicalStoreId}|${paymentId}`)
    .digest('base64url')
    .slice(0, 48)}`;

interface ValidatedContext {
  intent: ExistingOrderCanonicalPaymentIntent;
  payment: CanonicalPayment;
  existingProviderPaymentId: string;
}

const validateBeforeQr = async (input: {
  transaction: Transaction;
  canonicalStoreId: string;
  paymentIntentId: string;
  paymentId: string;
  now: Date;
}): Promise<ValidatedContext> => {
  const intentRef = adminDb.doc(`stores/${input.canonicalStoreId}/paymentIntents/${input.paymentIntentId}`);
  const paymentRef = adminDb.doc(`stores/${input.canonicalStoreId}/payments/${input.paymentId}`);
  const [intentSnapshot, paymentSnapshot] = await Promise.all([
    input.transaction.get(intentRef), input.transaction.get(paymentRef),
  ]);
  if (!intentSnapshot.exists || !paymentSnapshot.exists) throw new Error('LOCAL_STORE_PIX_PAYMENT_STATE_MISSING');
  const intent = normalizeCanonicalPaymentIntent(intentSnapshot.data() as ExistingOrderPaymentIntentDocument);
  const payment = normalizeCanonicalPayment(paymentSnapshot.data() as CanonicalPayment);
  assertPair({ intent, payment, canonicalStoreId: input.canonicalStoreId, paymentIntentId: input.paymentIntentId, paymentId: input.paymentId });
  const existingProviderPaymentId = boundProviderPaymentId(intent, payment);
  if (intent.status !== 'pending' || payment.status !== 'pending') throw new Error('LOCAL_STORE_PIX_PAYMENT_NOT_PENDING');
  // Before a QR exists, an expired intent cannot acquire a receiving authority.
  // Once bound, the QR is an external bank artifact and may need to be recovered
  // so a real late credit can still be reconciled, just like a provider charge.
  if (!existingProviderPaymentId && Date.parse(intent.expiresAt) <= input.now.getTime()) {
    throw new Error('LOCAL_STORE_PIX_INTENT_EXPIRED');
  }

  const orderRef = adminDb.doc(`stores/${input.canonicalStoreId}/orders/${intent.target.orderId}`);
  const paymentQuery = adminDb.collection(`stores/${input.canonicalStoreId}/payments`)
    .where('orderId', '==', intent.target.orderId).limit(MAX_PAYMENT_RECORDS_PER_ORDER);
  const [orderSnapshot, orderPayments] = await Promise.all([
    input.transaction.get(orderRef), input.transaction.get(paymentQuery),
  ]);
  if (!orderSnapshot.exists) throw new Error('LOCAL_STORE_PIX_ORDER_NOT_FOUND');
  const order = orderSnapshot.data() as DocumentData;
  if (
    clean(order.id, 220) !== intent.target.orderId || order.fulfillmentType !== 'dine_in' ||
    order.status === 'rejected' || order.status === 'cancelled'
  ) throw new Error('LOCAL_STORE_PIX_ORDER_NOT_ELIGIBLE');
  if (clean(order.buyerId, 220) !== intent.buyerId) throw new Error('LOCAL_STORE_PIX_BUYER_CHANGED');
  if (order.source === 'staff' && order.buyerIdentityStatus !== 'verified_account') {
    throw new Error('LOCAL_STORE_PIX_CUSTOMER_IDENTIFICATION_REQUIRED');
  }
  if (order.source === 'customer' && order.status === 'pending' && !clean(order.operatorId, 180)) {
    throw new Error('LOCAL_STORE_PIX_ATTENDANCE_APPROVAL_REQUIRED');
  }
  if (paymentContextForOrder(order) !== intent.context) throw new Error('LOCAL_STORE_PIX_CONTEXT_CHANGED');

  let payable;
  try { payable = summarizeLocalOrderPayable(order); }
  catch { throw new Error('LOCAL_STORE_PIX_ORDER_TOTAL_INVALID'); }
  if (payable.hasOperationalPaidQuantity) throw new Error('LOCAL_STORE_PIX_INTENT_STALE');
  if (orderPayments.size >= MAX_PAYMENT_RECORDS_PER_ORDER) throw new Error('LOCAL_STORE_PIX_PAYMENT_HISTORY_LIMIT');

  let currentFound = false;
  let authoritativelyPaidAmount = 0;
  for (const document of orderPayments.docs) {
    const compatible = classifyCompatiblePaymentRecord(document.data(), input.canonicalStoreId);
    if (compatible.kind === 'legacy_table_payment_mirror') continue;
    const candidate = compatible.payment;
    if (candidate.orderId !== intent.target.orderId) throw new Error('LOCAL_STORE_PIX_PAYMENT_SCOPE_INVALID');
    if (candidate.context !== intent.context) throw new Error('LOCAL_STORE_PIX_PAYMENT_CONTEXT_CONFLICT');
    if (candidate.id === payment.id) { currentFound = true; continue; }
    if (candidate.status === 'pending') throw new Error('LOCAL_STORE_PIX_OTHER_PAYMENT_PENDING');
    if (isPaymentAuthoritativelyPaid(candidate.status)) authoritativelyPaidAmount += candidate.amount;
  }
  if (!currentFound) throw new Error('LOCAL_STORE_PIX_PAYMENT_NOT_INDEXED');
  const remaining = Number((payable.billableAmount - authoritativelyPaidAmount).toFixed(2));
  if (Math.abs(remaining - intent.amount) > 0.009) throw new Error('LOCAL_STORE_PIX_INTENT_STALE');
  return { intent, payment, existingProviderPaymentId };
};

const bindAndResolveConfiguration = async (input: {
  canonicalStoreId: string;
  legacyStoreId: string;
  paymentIntentId: string;
  paymentId: string;
  providerPaymentId: string;
  newConfiguration: StoreOwnedPixConfiguration | null;
  updatedAt: string;
}): Promise<StoreOwnedPixConfiguration> => {
  const intentRef = adminDb.doc(`stores/${input.canonicalStoreId}/paymentIntents/${input.paymentIntentId}`);
  const paymentRef = adminDb.doc(`stores/${input.canonicalStoreId}/payments/${input.paymentId}`);
  const bindingRef = adminDb.doc(storeOwnedPixPaymentBindingPath(input.canonicalStoreId, input.providerPaymentId));
  const encryptedNewConfiguration = input.newConfiguration
    ? encryptIntegrationSecret(
        input.newConfiguration,
        getIntegrationMasterKey(),
        storeOwnedPixPaymentBindingAad(input)
      )
    : null;

  return adminDb.runTransaction(async transaction => {
    const [intentSnapshot, paymentSnapshot, bindingSnapshot] = await Promise.all([
      transaction.get(intentRef), transaction.get(paymentRef), transaction.get(bindingRef),
    ]);
    if (!intentSnapshot.exists || !paymentSnapshot.exists) throw new Error('LOCAL_STORE_PIX_PAYMENT_STATE_MISSING');
    const intent = normalizeCanonicalPaymentIntent(intentSnapshot.data() as ExistingOrderPaymentIntentDocument);
    const payment = normalizeCanonicalPayment(paymentSnapshot.data() as CanonicalPayment);
    assertPair({ intent, payment, canonicalStoreId: input.canonicalStoreId, paymentIntentId: input.paymentIntentId, paymentId: input.paymentId });
    const existing = boundProviderPaymentId(intent, payment);

    if (existing) {
      if (existing !== input.providerPaymentId || !bindingSnapshot.exists) throw new Error('LOCAL_STORE_PIX_BINDING_CONFLICT');
      const binding = parseStoreOwnedPixPaymentBinding(bindingSnapshot.data(), input);
      return decryptIntegrationSecret<StoreOwnedPixConfiguration>(
        binding.encryptedConfiguration,
        getIntegrationMasterKey(),
        storeOwnedPixPaymentBindingAad(input)
      );
    }

    if (bindingSnapshot.exists || !input.newConfiguration || !encryptedNewConfiguration) {
      throw new Error('LOCAL_STORE_PIX_BINDING_CONFLICT');
    }
    transaction.set(bindingRef, {
      schemaVersion: 1,
      provider: PROVIDER,
      canonicalStoreId: input.canonicalStoreId,
      legacyStoreId: input.legacyStoreId,
      paymentIntentId: input.paymentIntentId,
      paymentId: input.paymentId,
      providerPaymentId: input.providerPaymentId,
      encryptedConfiguration: encryptedNewConfiguration,
      createdAt: input.updatedAt,
    });
    transaction.update(intentRef, {
      provider: PROVIDER,
      providerIntentId: input.providerPaymentId,
      updatedAt: input.updatedAt,
    });
    transaction.update(paymentRef, {
      provider: PROVIDER,
      providerPaymentId: input.providerPaymentId,
      updatedAt: input.updatedAt,
    });
    return input.newConfiguration;
  });
};

export interface LocalStoreOwnedPixResult {
  provider: 'store-pix'; providerPaymentId: string; status: 'pending';
  qrCode: string; qrCodeBase64: string; ticketUrl: ''; expiresAt: string;
  paymentIntentId: string; paymentId: string; orderId: string; amount: number;
  currency: 'BRL'; context: 'table' | 'pos';
  confirmationAuthority: 'operator_attestation'; bankVerifiedByKyrub: false;
}

export const attachStoreOwnedPixToLocalIntent = async (input: {
  authenticatedUserId: string; value: unknown; now?: Date;
}): Promise<LocalStoreOwnedPixResult> => {
  const request = parseLocalPixProviderAttachInput(input.value);
  const actorUserId = clean(input.authenticatedUserId, 180);
  if (!actorUserId || actorUserId !== request.storeId) throw new Error('LOCAL_STORE_PIX_FORBIDDEN');
  const storeContext = await resolveInPersonOrderStoreContext(request.storeId);
  const now = input.now ?? new Date();
  if (Number.isNaN(now.getTime())) throw new Error('LOCAL_STORE_PIX_TIME_INVALID');

  const validated = await adminDb.runTransaction(transaction => validateBeforeQr({
    transaction,
    canonicalStoreId: storeContext.canonicalStoreId,
    paymentIntentId: request.paymentIntentId,
    paymentId: request.paymentId,
    now,
  }));
  const providerPaymentId = validated.existingProviderPaymentId ||
    providerPaymentIdFor(storeContext.canonicalStoreId, validated.payment.id);
  const currentConfiguration = validated.existingProviderPaymentId
    ? null
    : await loadStoreOwnedPixConfiguration(request.storeId, { requireEnabled: true });
  const configuration = await bindAndResolveConfiguration({
    canonicalStoreId: storeContext.canonicalStoreId,
    legacyStoreId: request.storeId,
    paymentIntentId: validated.intent.id,
    paymentId: validated.payment.id,
    providerPaymentId,
    newConfiguration: currentConfiguration,
    updatedAt: now.toISOString(),
  });
  const brCode = buildStoreOwnedPixBrCode({
    configuration, amount: validated.intent.amount, paymentId: validated.payment.id,
  });

  return {
    provider: PROVIDER,
    providerPaymentId,
    status: 'pending',
    qrCode: brCode.payload,
    qrCodeBase64: createPixQrCodeDataUri(brCode.payload),
    ticketUrl: '',
    expiresAt: validated.intent.expiresAt,
    paymentIntentId: validated.intent.id,
    paymentId: validated.payment.id,
    orderId: validated.intent.target.orderId,
    amount: validated.intent.amount,
    currency: 'BRL',
    context: validated.intent.context,
    confirmationAuthority: 'operator_attestation',
    bankVerifiedByKyrub: false,
  };
};
