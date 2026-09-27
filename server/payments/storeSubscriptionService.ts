import { createHash, randomUUID } from 'node:crypto';
import { adminDb } from '../firebaseAdmin.js';
import { authenticateConsultantRequest } from '../ai/consultantAuth.js';
import { mercadoPagoStoreRequest } from '../integrations/mercadoPagoStoreOauthService.js';
import {
  parseProductSaleModality,
  type ProductSaleModality,
  type ProductSubscriptionTerms,
} from '../../shared/productSaleModality.js';
import {
  STORE_SUBSCRIPTION_SCHEMA_VERSION,
  type StoreSubscriptionCheckoutResult,
  type StoreSubscriptionPaymentStatus,
  type StoreSubscriptionProviderStatus,
  type StoreSubscriptionSnapshot,
  type StoreSubscriptionState,
} from '../../shared/storeSubscriptionBilling.js';
import { resolveCommercialRecipientAuthority } from './commercialRecipientAuthorityService.js';
import { verifyMercadoPagoWebhookSignature } from './mercadoPagoPixProvider.js';

const PROVIDER = 'mercado_pago' as const;
const CURRENCY = 'BRL' as const;
const SUBSCRIPTION_COLLECTION = 'subscriptions';
const SLOT_COLLECTION = 'subscriptionCheckoutSlots';
const PROVIDER_BINDING_COLLECTION = 'mercadoPagoStoreSubscriptionBindings';
const ACCOUNT_BINDING_COLLECTION = 'mercadoPagoMerchantAccountBindings';
const CREATION_LOCK_MS = 10 * 60 * 1000;

const clean = (value: unknown): string =>
  typeof value === 'string' || typeof value === 'number' ? String(value).trim() : '';
const record = (value: unknown): Record<string, unknown> =>
  value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
const hash = (value: string): string => createHash('sha256').update(value).digest('hex');
const nowIso = (): string => new Date().toISOString();
const safeIdentity = (value: unknown): string => {
  const normalized = clean(value);
  return normalized && normalized.length <= 180 && !normalized.includes('/')
    ? normalized
    : '';
};
const validEmail = (value: unknown): string => {
  const email = clean(value).toLocaleLowerCase('pt-BR');
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/u.test(email) ? email : '';
};
const validIsoTime = (value: unknown): number => {
  const parsed = Date.parse(clean(value));
  return Number.isFinite(parsed) ? parsed : 0;
};

export class StoreSubscriptionError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: string,
    message: string
  ) {
    super(message);
    this.name = 'StoreSubscriptionError';
  }
}

const fail = (status: number, code: string, message: string): never => {
  throw new StoreSubscriptionError(status, code, message);
};

interface CanonicalStoreIdentity {
  canonicalStoreId: string;
  ownerUserId: string;
  legacyStoreId: string;
}

interface PublishedSubscriptionProduct {
  id: string;
  name: string;
  amountMinor: number;
  saleModality: ProductSaleModality & { subscription: ProductSubscriptionTerms };
}

interface InternalStoreSubscriptionRecord {
  schemaVersion: 1;
  id: string;
  storeId: string;
  ownerUserId: string;
  legacyStoreId: string;
  buyerId: string;
  buyerEmail: string;
  productId: string;
  productName: string;
  amountMinor: number;
  currency: 'BRL';
  saleModality: ProductSaleModality;
  provider: 'mercado_pago';
  providerSubscriptionId: string;
  providerStatus: StoreSubscriptionProviderStatus;
  state: StoreSubscriptionState;
  checkoutUrl: string;
  credentialScopeId: string;
  externalAccountId: string;
  externalReference: string;
  providerInvoiceId: string;
  providerPaymentId: string;
  providerPaymentStatus: StoreSubscriptionPaymentStatus;
  providerPaymentStatusDetail: string;
  providerPaymentOccurredAt: string;
  createdAt: string;
  updatedAt: string;
  activatedAt: string;
  cancelledAt: string;
  paymentConfirmedAt: string;
}

interface ProviderBinding {
  providerSubscriptionId: string;
  storeId: string;
  subscriptionId: string;
  credentialScopeId: string;
  externalAccountId: string;
}

interface AccountBinding {
  externalAccountId: string;
  credentialScopeId: string;
  ownerUserId: string;
}

interface MpPreapproval {
  id?: unknown;
  status?: unknown;
  init_point?: unknown;
  collector_id?: unknown;
  external_reference?: unknown;
  auto_recurring?: unknown;
}

interface ProviderInvoiceSnapshot {
  invoiceId: string;
  paymentId: string;
  paymentStatus: StoreSubscriptionPaymentStatus;
  paymentStatusDetail: string;
  occurredAt: string;
}

const subscriptionPath = (storeId: string, subscriptionId: string): string =>
  `stores/${storeId}/${SUBSCRIPTION_COLLECTION}/${subscriptionId}`;
const slotPath = (storeId: string, buyerId: string, productId: string): string =>
  `stores/${storeId}/${SLOT_COLLECTION}/${hash(`${buyerId}:${productId}`)}`;
const providerBindingPath = (providerSubscriptionId: string): string =>
  `${PROVIDER_BINDING_COLLECTION}/${hash(providerSubscriptionId)}`;
const accountBindingPath = (externalAccountId: string): string =>
  `${ACCOUNT_BINDING_COLLECTION}/${hash(externalAccountId)}`;

const providerBackUrl = (): string =>
  clean(process.env.KYRUB_STORE_SUBSCRIPTION_RETURN_URL) || 'https://kyrub.com/?app=1';

const providerWebhookUrl = (): string => {
  const explicit = clean(process.env.KYRUB_STORE_SUBSCRIPTION_WEBHOOK_URL);
  if (explicit) return explicit;
  const planWebhook = clean(process.env.KYRUB_PLAN_BILLING_WEBHOOK_URL);
  if (planWebhook) {
    try {
      const url = new URL(planWebhook);
      url.searchParams.set('op', 'merchant.subscription.webhook');
      return url.toString();
    } catch {
      // Fall through to the canonical public endpoint.
    }
  }
  return 'https://kyrub.com/api/plan-control?op=merchant.subscription.webhook';
};

const resolveCanonicalStore = async (storeReference: unknown): Promise<CanonicalStoreIdentity> => {
  const input = safeIdentity(storeReference);
  if (!input) fail(400, 'STORE_SUBSCRIPTION_STORE_REQUIRED', 'A loja não foi identificada.');

  const direct = await adminDb.doc(`stores/${input}`).get();
  let canonical = direct;
  if (!direct.exists) {
    const matches = await adminDb
      .collection('stores')
      .where('legacyTenantId', '==', input)
      .limit(2)
      .get();
    if (matches.empty) {
      fail(404, 'STORE_SUBSCRIPTION_STORE_NOT_FOUND', 'A loja não foi encontrada.');
    }
    if (matches.size !== 1) {
      fail(409, 'STORE_SUBSCRIPTION_STORE_AMBIGUOUS', 'A identidade da loja está ambígua.');
    }
    canonical = matches.docs[0];
  }

  const data = canonical.data() as Record<string, unknown>;
  const canonicalStoreId = safeIdentity(canonical.id);
  const ownerUserId = safeIdentity(data.ownerId);
  const legacyStoreId = safeIdentity(data.legacyTenantId) || ownerUserId;
  if (!canonicalStoreId || !ownerUserId || !legacyStoreId || legacyStoreId !== ownerUserId) {
    fail(409, 'STORE_SUBSCRIPTION_STORE_IDENTITY_INVALID', 'A identidade financeira da loja está inconsistente.');
  }

  const tenant = await adminDb.doc(`tenants/${legacyStoreId}`).get();
  if (!tenant.exists || clean(tenant.data()?.publicationStatus) !== 'published') {
    fail(404, 'STORE_SUBSCRIPTION_STORE_UNAVAILABLE', 'A loja não está disponível no marketplace.');
  }

  return { canonicalStoreId, ownerUserId, legacyStoreId };
};

const loadPublishedSubscriptionProduct = async (
  storeId: string,
  productIdInput: unknown
): Promise<PublishedSubscriptionProduct> => {
  const productId = safeIdentity(productIdInput);
  if (!productId) fail(400, 'STORE_SUBSCRIPTION_PRODUCT_REQUIRED', 'O produto não foi identificado.');
  const snapshot = await adminDb.doc(`stores/${storeId}/products/${productId}`).get();
  if (!snapshot.exists) {
    fail(404, 'STORE_SUBSCRIPTION_PRODUCT_NOT_FOUND', 'O produto não está disponível.');
  }
  const data = snapshot.data() as Record<string, unknown>;
  if (clean(data.publicationStatus) !== 'published') {
    fail(409, 'STORE_SUBSCRIPTION_PRODUCT_NOT_PUBLISHED', 'O produto não está publicado.');
  }
  const name = clean(data.name);
  const price = Number(data.price);
  const amountMinor = Number.isFinite(price) ? Math.round(price * 100) : 0;
  const saleModality = parseProductSaleModality(data.saleModality);
  if (!name || amountMinor <= 0) {
    fail(409, 'STORE_SUBSCRIPTION_PRODUCT_NOT_BILLABLE', 'A assinatura não possui um valor recorrente válido.');
  }
  if (!saleModality || saleModality.mode !== 'subscription' || !saleModality.subscription) {
    fail(409, 'STORE_SUBSCRIPTION_PRODUCT_NOT_RECURRING', 'Este item não é uma assinatura.');
  }
  return {
    id: productId,
    name,
    amountMinor,
    saleModality: saleModality as ProductSaleModality & { subscription: ProductSubscriptionTerms },
  };
};

const recurrenceForProvider = (terms: ProductSubscriptionTerms): {
  frequency: number;
  frequency_type: 'days' | 'months';
} => {
  const count = terms.billingInterval.count;
  switch (terms.billingInterval.unit) {
    case 'day':
      return { frequency: count, frequency_type: 'days' };
    case 'week':
      return { frequency: count * 7, frequency_type: 'days' };
    case 'month':
      return { frequency: count, frequency_type: 'months' };
    case 'year':
      return { frequency: count * 12, frequency_type: 'months' };
  }
};

const providerStatus = (value: unknown): StoreSubscriptionProviderStatus => {
  const status = clean(value).toLowerCase();
  if (status === 'authorized') return 'authorized';
  if (status === 'paused') return 'paused';
  if (status === 'canceled' || status === 'cancelled') return 'cancelled';
  return 'pending';
};

const paymentStatus = (
  statusValue: unknown,
  detailValue: unknown
): StoreSubscriptionPaymentStatus => {
  const status = clean(statusValue).toLowerCase();
  const detail = clean(detailValue).toLowerCase();
  if (status === 'approved' && detail === 'accredited') return 'approved';
  if (status === 'rejected') return 'rejected';
  if (
    status === 'cancelled' ||
    status === 'canceled' ||
    status === 'refunded' ||
    status === 'charged_back'
  ) return 'cancelled';
  if (status) return 'pending';
  return 'pending_confirmation';
};

const safeSnapshot = (subscription: InternalStoreSubscriptionRecord): StoreSubscriptionSnapshot => ({
  schemaVersion: STORE_SUBSCRIPTION_SCHEMA_VERSION,
  id: subscription.id,
  storeId: subscription.storeId,
  buyerId: subscription.buyerId,
  productId: subscription.productId,
  productName: subscription.productName,
  amountMinor: subscription.amountMinor,
  currency: CURRENCY,
  saleModality: subscription.saleModality,
  provider: PROVIDER,
  providerSubscriptionId: subscription.providerSubscriptionId,
  providerStatus: subscription.providerStatus,
  state: subscription.state,
  checkoutUrl: subscription.checkoutUrl,
  providerInvoiceId: subscription.providerInvoiceId,
  providerPaymentId: subscription.providerPaymentId,
  providerPaymentStatus: subscription.providerPaymentStatus,
  providerPaymentStatusDetail: subscription.providerPaymentStatusDetail,
  providerPaymentOccurredAt: subscription.providerPaymentOccurredAt,
  createdAt: subscription.createdAt,
  updatedAt: subscription.updatedAt,
  activatedAt: subscription.activatedAt,
  cancelledAt: subscription.cancelledAt,
  paymentConfirmedAt: subscription.paymentConfirmedAt,
});

const parseStoredSubscription = (value: unknown): InternalStoreSubscriptionRecord | null => {
  const data = record(value);
  const saleModality = parseProductSaleModality(data.saleModality);
  const amountMinor = Number(data.amountMinor);
  const providerSubscriptionId = safeIdentity(data.providerSubscriptionId);
  const id = safeIdentity(data.id);
  const storeId = safeIdentity(data.storeId);
  const buyerId = safeIdentity(data.buyerId);
  const productId = safeIdentity(data.productId);
  const ownerUserId = safeIdentity(data.ownerUserId);
  const legacyStoreId = safeIdentity(data.legacyStoreId);
  const credentialScopeId = safeIdentity(data.credentialScopeId);
  const externalAccountId = safeIdentity(data.externalAccountId);
  if (
    data.schemaVersion !== STORE_SUBSCRIPTION_SCHEMA_VERSION ||
    !id || !storeId || !buyerId || !productId || !ownerUserId || !legacyStoreId ||
    !credentialScopeId || !externalAccountId || !providerSubscriptionId ||
    !Number.isInteger(amountMinor) || amountMinor <= 0 ||
    !saleModality || saleModality.mode !== 'subscription' || !saleModality.subscription
  ) return null;

  const state: StoreSubscriptionState =
    data.state === 'active' ||
    data.state === 'payment_due' ||
    data.state === 'paused' ||
    data.state === 'cancelled'
      ? data.state
      : 'pending';
  const payment =
    data.providerPaymentStatus === 'approved' ||
    data.providerPaymentStatus === 'pending' ||
    data.providerPaymentStatus === 'rejected' ||
    data.providerPaymentStatus === 'cancelled' ||
    data.providerPaymentStatus === 'pending_confirmation'
      ? data.providerPaymentStatus
      : '';

  return {
    schemaVersion: STORE_SUBSCRIPTION_SCHEMA_VERSION,
    id,
    storeId,
    ownerUserId,
    legacyStoreId,
    buyerId,
    buyerEmail: validEmail(data.buyerEmail),
    productId,
    productName: clean(data.productName),
    amountMinor,
    currency: CURRENCY,
    saleModality,
    provider: PROVIDER,
    providerSubscriptionId,
    providerStatus: providerStatus(data.providerStatus),
    state,
    checkoutUrl: clean(data.checkoutUrl),
    credentialScopeId,
    externalAccountId,
    externalReference: clean(data.externalReference),
    providerInvoiceId: safeIdentity(data.providerInvoiceId),
    providerPaymentId: safeIdentity(data.providerPaymentId),
    providerPaymentStatus: payment,
    providerPaymentStatusDetail: clean(data.providerPaymentStatusDetail),
    providerPaymentOccurredAt: clean(data.providerPaymentOccurredAt),
    createdAt: clean(data.createdAt),
    updatedAt: clean(data.updatedAt),
    activatedAt: clean(data.activatedAt),
    cancelledAt: clean(data.cancelledAt),
    paymentConfirmedAt: clean(data.paymentConfirmedAt),
  };
};

const parseProviderBinding = (value: unknown): ProviderBinding | null => {
  const data = record(value);
  const providerSubscriptionId = safeIdentity(data.providerSubscriptionId);
  const storeId = safeIdentity(data.storeId);
  const subscriptionId = safeIdentity(data.subscriptionId);
  const credentialScopeId = safeIdentity(data.credentialScopeId);
  const externalAccountId = safeIdentity(data.externalAccountId);
  return providerSubscriptionId && storeId && subscriptionId && credentialScopeId && externalAccountId
    ? { providerSubscriptionId, storeId, subscriptionId, credentialScopeId, externalAccountId }
    : null;
};

const parseAccountBinding = (value: unknown): AccountBinding | null => {
  const data = record(value);
  const externalAccountId = safeIdentity(data.externalAccountId);
  const credentialScopeId = safeIdentity(data.credentialScopeId);
  const ownerUserId = safeIdentity(data.ownerUserId);
  return externalAccountId && credentialScopeId && ownerUserId
    ? { externalAccountId, credentialScopeId, ownerUserId }
    : null;
};

const loadProviderBinding = async (providerSubscriptionId: string): Promise<ProviderBinding | null> => {
  const snapshot = await adminDb.doc(providerBindingPath(providerSubscriptionId)).get();
  if (!snapshot.exists) return null;
  const binding = parseProviderBinding(snapshot.data());
  return binding?.providerSubscriptionId === providerSubscriptionId ? binding : null;
};

const loadAccountBinding = async (externalAccountId: string): Promise<AccountBinding | null> => {
  const snapshot = await adminDb.doc(accountBindingPath(externalAccountId)).get();
  if (!snapshot.exists) return null;
  const binding = parseAccountBinding(snapshot.data());
  return binding?.externalAccountId === externalAccountId ? binding : null;
};

const assertProviderPreapproval = (
  subscription: InternalStoreSubscriptionRecord,
  provider: MpPreapproval
): StoreSubscriptionProviderStatus => {
  const recurring = record(provider.auto_recurring);
  const recurrence = recurrenceForProvider(
    (subscription.saleModality as ProductSaleModality & { subscription: ProductSubscriptionTerms }).subscription
  );
  const amount = Number(recurring.transaction_amount);
  const amountMinor = Number.isFinite(amount) ? Math.round(amount * 100) : 0;
  if (
    safeIdentity(provider.id) !== subscription.providerSubscriptionId ||
    safeIdentity(provider.collector_id) !== subscription.externalAccountId ||
    clean(provider.external_reference) !== subscription.externalReference ||
    clean(recurring.currency_id) !== CURRENCY ||
    amountMinor !== subscription.amountMinor ||
    Number(recurring.frequency) !== recurrence.frequency ||
    clean(recurring.frequency_type) !== recurrence.frequency_type
  ) {
    fail(409, 'STORE_SUBSCRIPTION_PROVIDER_MISMATCH', 'A assinatura retornada pelo provedor não corresponde ao contrato do Kyrub.');
  }
  return providerStatus(provider.status);
};

const loadLatestInvoice = async (
  subscription: InternalStoreSubscriptionRecord
): Promise<ProviderInvoiceSnapshot | null> => {
  const payload = await mercadoPagoStoreRequest<Record<string, unknown>>(
    subscription.credentialScopeId,
    `/authorized_payments/search?preapproval_id=${encodeURIComponent(subscription.providerSubscriptionId)}`
  );
  const results = Array.isArray(payload.results) ? payload.results : [];
  let latest: ProviderInvoiceSnapshot | null = null;
  let latestTime = -1;

  for (const raw of results) {
    const invoice = record(raw);
    const payment = record(invoice.payment);
    const amount = Number(invoice.transaction_amount);
    const amountMinor = Number.isFinite(amount) ? Math.round(amount * 100) : 0;
    if (safeIdentity(invoice.preapproval_id) !== subscription.providerSubscriptionId) continue;
    if (clean(invoice.currency_id) !== CURRENCY || amountMinor !== subscription.amountMinor) continue;

    const invoiceId = safeIdentity(invoice.id);
    if (!invoiceId) continue;
    const occurredAt =
      clean(invoice.last_modified) ||
      clean(invoice.date_created) ||
      clean(payment.date_last_updated) ||
      clean(payment.date_created) ||
      nowIso();
    const occurredTime = validIsoTime(occurredAt);
    if (latest && occurredTime < latestTime) continue;

    const status = paymentStatus(payment.status, payment.status_detail);
    const paymentId = safeIdentity(payment.id);
    if (status === 'approved' && !paymentId) continue;
    latest = {
      invoiceId,
      paymentId,
      paymentStatus: status,
      paymentStatusDetail: clean(payment.status_detail),
      occurredAt,
    };
    latestTime = occurredTime;
  }
  return latest;
};

const loadInternalSubscription = async (
  storeId: string,
  subscriptionId: string
): Promise<InternalStoreSubscriptionRecord> => {
  const snapshot = await adminDb.doc(subscriptionPath(storeId, subscriptionId)).get();
  const subscription = snapshot.exists ? parseStoredSubscription(snapshot.data()) : null;
  if (!subscription || subscription.storeId !== storeId || subscription.id !== subscriptionId) {
    fail(404, 'STORE_SUBSCRIPTION_NOT_FOUND', 'A assinatura não foi encontrada.');
  }
  return subscription;
};

const releaseCheckoutSlotIfCancelled = async (
  subscription: InternalStoreSubscriptionRecord
): Promise<void> => {
  if (subscription.state !== 'cancelled') return;
  const reference = adminDb.doc(
    slotPath(subscription.storeId, subscription.buyerId, subscription.productId)
  );
  await adminDb.runTransaction(async transaction => {
    const snapshot = await transaction.get(reference);
    if (!snapshot.exists) return;
    const data = record(snapshot.data());
    if (safeIdentity(data.subscriptionId) !== subscription.id) return;
    transaction.set(reference, {
      state: 'cancelled',
      subscriptionId: subscription.id,
      updatedAt: nowIso(),
    }, { merge: true });
  });
};

const reconcileInternalSubscription = async (
  subscription: InternalStoreSubscriptionRecord
): Promise<InternalStoreSubscriptionRecord> => {
  const provider = await mercadoPagoStoreRequest<MpPreapproval>(
    subscription.credentialScopeId,
    `/preapproval/${encodeURIComponent(subscription.providerSubscriptionId)}`
  );
  const nextProviderStatus = assertProviderPreapproval(subscription, provider);
  const latestInvoice = nextProviderStatus === 'authorized'
    ? await loadLatestInvoice(subscription)
    : null;

  let nextState: StoreSubscriptionState = 'pending';
  if (nextProviderStatus === 'cancelled') nextState = 'cancelled';
  else if (nextProviderStatus === 'paused') nextState = 'paused';
  else if (nextProviderStatus === 'authorized') {
    if (latestInvoice?.paymentStatus === 'approved') nextState = 'active';
    else if (latestInvoice) nextState = subscription.activatedAt ? 'payment_due' : 'pending';
    else nextState = subscription.activatedAt ? 'active' : 'pending';
  }

  const updatedAt = nowIso();
  const next: InternalStoreSubscriptionRecord = {
    ...subscription,
    providerStatus: nextProviderStatus,
    state: nextState,
    checkoutUrl: clean(provider.init_point) || subscription.checkoutUrl,
    providerInvoiceId: latestInvoice?.invoiceId ?? subscription.providerInvoiceId,
    providerPaymentId: latestInvoice?.paymentId ?? '',
    providerPaymentStatus: latestInvoice?.paymentStatus ?? (
      nextProviderStatus === 'authorized' && !subscription.activatedAt
        ? 'pending_confirmation'
        : subscription.providerPaymentStatus
    ),
    providerPaymentStatusDetail:
      latestInvoice?.paymentStatusDetail ?? subscription.providerPaymentStatusDetail,
    providerPaymentOccurredAt:
      latestInvoice?.occurredAt ?? subscription.providerPaymentOccurredAt,
    activatedAt:
      nextState === 'active' ? subscription.activatedAt || updatedAt : subscription.activatedAt,
    cancelledAt:
      nextState === 'cancelled' ? subscription.cancelledAt || updatedAt : '',
    paymentConfirmedAt:
      latestInvoice?.paymentStatus === 'approved'
        ? latestInvoice.occurredAt || updatedAt
        : subscription.paymentConfirmedAt,
    updatedAt,
  };

  await adminDb.doc(subscriptionPath(subscription.storeId, subscription.id)).set(next, { merge: true });
  await releaseCheckoutSlotIfCancelled(next);
  return next;
};

const reserveCheckoutSlot = async (input: {
  storeId: string;
  buyerId: string;
  productId: string;
}): Promise<{ subscriptionId: string; existing: boolean }> => {
  const reference = adminDb.doc(slotPath(input.storeId, input.buyerId, input.productId));
  return adminDb.runTransaction(async transaction => {
    const snapshot = await transaction.get(reference);
    const data = snapshot.exists ? record(snapshot.data()) : {};
    const existingSubscriptionId = safeIdentity(data.subscriptionId);
    const slotState = clean(data.state);

    if (slotState === 'ready' && existingSubscriptionId) {
      const subscriptionSnapshot = await transaction.get(
        adminDb.doc(subscriptionPath(input.storeId, existingSubscriptionId))
      );
      const existing = subscriptionSnapshot.exists
        ? parseStoredSubscription(subscriptionSnapshot.data())
        : null;
      if (existing && existing.state !== 'cancelled') {
        return { subscriptionId: existingSubscriptionId, existing: true };
      }
    }

    if (slotState === 'creating') {
      const lockAge = Date.now() - validIsoTime(data.updatedAt);
      if (lockAge >= 0 && lockAge < CREATION_LOCK_MS) {
        fail(409, 'STORE_SUBSCRIPTION_CREATION_IN_PROGRESS', 'A criação desta assinatura já está em andamento.');
      }
    }

    const subscriptionId = `store-sub-${randomUUID()}`;
    transaction.set(reference, {
      state: 'creating',
      storeId: input.storeId,
      buyerId: input.buyerId,
      productId: input.productId,
      subscriptionId,
      updatedAt: nowIso(),
    });
    return { subscriptionId, existing: false };
  });
};

const failCheckoutSlot = async (
  storeId: string,
  buyerId: string,
  productId: string,
  subscriptionId: string
): Promise<void> => {
  await adminDb.doc(slotPath(storeId, buyerId, productId)).set({
    state: 'failed',
    subscriptionId,
    updatedAt: nowIso(),
  }, { merge: true }).catch(() => undefined);
};

const persistCreatedSubscription = async (
  subscription: InternalStoreSubscriptionRecord
): Promise<void> => {
  const subscriptionRef = adminDb.doc(subscriptionPath(subscription.storeId, subscription.id));
  const slotRef = adminDb.doc(slotPath(subscription.storeId, subscription.buyerId, subscription.productId));
  const providerRef = adminDb.doc(providerBindingPath(subscription.providerSubscriptionId));
  const accountRef = adminDb.doc(accountBindingPath(subscription.externalAccountId));

  await adminDb.runTransaction(async transaction => {
    const [existingProvider, existingAccount] = await Promise.all([
      transaction.get(providerRef),
      transaction.get(accountRef),
    ]);
    if (existingProvider.exists) {
      const binding = parseProviderBinding(existingProvider.data());
      if (!binding || binding.subscriptionId !== subscription.id || binding.storeId !== subscription.storeId) {
        fail(409, 'STORE_SUBSCRIPTION_PROVIDER_BINDING_CONFLICT', 'A assinatura do provedor já está vinculada a outro contrato.');
      }
    }
    if (existingAccount.exists) {
      const binding = parseAccountBinding(existingAccount.data());
      if (
        !binding ||
        binding.externalAccountId !== subscription.externalAccountId ||
        binding.credentialScopeId !== subscription.credentialScopeId ||
        binding.ownerUserId !== subscription.ownerUserId
      ) {
        fail(409, 'STORE_SUBSCRIPTION_ACCOUNT_BINDING_CONFLICT', 'A conta Mercado Pago está vinculada a outra identidade Kyrub.');
      }
    }

    transaction.set(subscriptionRef, subscription);
    transaction.set(providerRef, {
      providerSubscriptionId: subscription.providerSubscriptionId,
      storeId: subscription.storeId,
      subscriptionId: subscription.id,
      credentialScopeId: subscription.credentialScopeId,
      externalAccountId: subscription.externalAccountId,
      updatedAt: nowIso(),
    });
    transaction.set(accountRef, {
      externalAccountId: subscription.externalAccountId,
      credentialScopeId: subscription.credentialScopeId,
      ownerUserId: subscription.ownerUserId,
      updatedAt: nowIso(),
    }, { merge: true });
    transaction.set(slotRef, {
      state: 'ready',
      subscriptionId: subscription.id,
      updatedAt: nowIso(),
    }, { merge: true });
  });
};

export const createAuthorizedStoreSubscription = async (
  authorization: string,
  body: unknown
): Promise<StoreSubscriptionCheckoutResult> => {
  const identity = await authenticateConsultantRequest(authorization);
  const payload = record(body);
  const buyerEmail = validEmail(identity.email);
  if (!buyerEmail || identity.emailVerified === false) {
    fail(409, 'STORE_SUBSCRIPTION_EMAIL_UNVERIFIED', 'Confirme seu e-mail antes de iniciar uma assinatura.');
  }

  const store = await resolveCanonicalStore(payload.storeId);
  const product = await loadPublishedSubscriptionProduct(store.canonicalStoreId, payload.productId);
  const recipient = await resolveCommercialRecipientAuthority({
    context: 'store_subscription',
    canonicalStoreId: store.canonicalStoreId,
  });
  if (
    recipient.recipientKind !== 'merchant_store' ||
    recipient.ownerUserId !== store.ownerUserId ||
    recipient.credentialScopeId !== store.legacyStoreId
  ) {
    fail(409, 'STORE_SUBSCRIPTION_RECIPIENT_MISMATCH', 'A conta recebedora da loja está inconsistente.');
  }

  const slot = await reserveCheckoutSlot({
    storeId: store.canonicalStoreId,
    buyerId: identity.uid,
    productId: product.id,
  });
  if (slot.existing) {
    const existing = await loadInternalSubscription(store.canonicalStoreId, slot.subscriptionId);
    if (existing.buyerId !== identity.uid || existing.productId !== product.id) {
      fail(409, 'STORE_SUBSCRIPTION_SLOT_CONFLICT', 'A assinatura existente não pertence a este comprador e produto.');
    }
    const reconciled = await reconcileInternalSubscription(existing);
    return { subscription: safeSnapshot(reconciled), checkoutUrl: reconciled.checkoutUrl };
  }

  const externalReference = `kyrub-store-subscription:${slot.subscriptionId}`;
  const recurrence = recurrenceForProvider(product.saleModality.subscription);
  let provider: MpPreapproval | null = null;

  try {
    provider = await mercadoPagoStoreRequest<MpPreapproval>(
      recipient.credentialScopeId,
      '/preapproval',
      {
        method: 'POST',
        headers: { 'X-Idempotency-Key': slot.subscriptionId },
        body: JSON.stringify({
          reason: product.name,
          external_reference: externalReference,
          payer_email: buyerEmail,
          auto_recurring: {
            frequency: recurrence.frequency,
            frequency_type: recurrence.frequency_type,
            transaction_amount: product.amountMinor / 100,
            currency_id: CURRENCY,
          },
          back_url: providerBackUrl(),
          notification_url: providerWebhookUrl(),
          status: 'pending',
        }),
      }
    );

    const providerSubscriptionId = safeIdentity(provider.id);
    const checkoutUrl = clean(provider.init_point);
    const providerCollectorId = safeIdentity(provider.collector_id);
    if (!providerSubscriptionId || !checkoutUrl || providerCollectorId !== recipient.externalAccountId) {
      fail(502, 'STORE_SUBSCRIPTION_PROVIDER_RESPONSE_INVALID', 'O provedor não confirmou a assinatura na conta correta da loja.');
    }

    const recurring = record(provider.auto_recurring);
    const providerAmount = Number(recurring.transaction_amount);
    if (
      clean(provider.external_reference) !== externalReference ||
      clean(recurring.currency_id) !== CURRENCY ||
      Math.round(providerAmount * 100) !== product.amountMinor ||
      Number(recurring.frequency) !== recurrence.frequency ||
      clean(recurring.frequency_type) !== recurrence.frequency_type
    ) {
      fail(502, 'STORE_SUBSCRIPTION_PROVIDER_TERMS_MISMATCH', 'O provedor devolveu termos diferentes da assinatura cadastrada.');
    }

    const timestamp = nowIso();
    const subscription: InternalStoreSubscriptionRecord = {
      schemaVersion: STORE_SUBSCRIPTION_SCHEMA_VERSION,
      id: slot.subscriptionId,
      storeId: store.canonicalStoreId,
      ownerUserId: store.ownerUserId,
      legacyStoreId: store.legacyStoreId,
      buyerId: identity.uid,
      buyerEmail,
      productId: product.id,
      productName: product.name,
      amountMinor: product.amountMinor,
      currency: CURRENCY,
      saleModality: product.saleModality,
      provider: PROVIDER,
      providerSubscriptionId,
      providerStatus: providerStatus(provider.status),
      state: 'pending',
      checkoutUrl,
      credentialScopeId: recipient.credentialScopeId,
      externalAccountId: recipient.externalAccountId,
      externalReference,
      providerInvoiceId: '',
      providerPaymentId: '',
      providerPaymentStatus:
        providerStatus(provider.status) === 'authorized' ? 'pending_confirmation' : '',
      providerPaymentStatusDetail: '',
      providerPaymentOccurredAt: '',
      createdAt: timestamp,
      updatedAt: timestamp,
      activatedAt: '',
      cancelledAt: '',
      paymentConfirmedAt: '',
    };

    await persistCreatedSubscription(subscription);
    const reconciled = await reconcileInternalSubscription(subscription);
    return { subscription: safeSnapshot(reconciled), checkoutUrl: reconciled.checkoutUrl };
  } catch (error) {
    await failCheckoutSlot(
      store.canonicalStoreId,
      identity.uid,
      product.id,
      slot.subscriptionId
    );
    const providerSubscriptionId = provider ? safeIdentity(provider.id) : '';
    if (providerSubscriptionId) {
      await mercadoPagoStoreRequest(
        recipient.credentialScopeId,
        `/preapproval/${encodeURIComponent(providerSubscriptionId)}`,
        { method: 'PUT', body: JSON.stringify({ status: 'canceled' }) }
      ).catch(() => undefined);
    }
    throw error;
  }
};

const loadAuthorizedSubscription = async (
  authorization: string,
  body: unknown
): Promise<InternalStoreSubscriptionRecord> => {
  const identity = await authenticateConsultantRequest(authorization);
  const payload = record(body);
  const store = await resolveCanonicalStore(payload.storeId);
  const subscriptionId = safeIdentity(payload.subscriptionId);
  if (!subscriptionId) fail(400, 'STORE_SUBSCRIPTION_ID_REQUIRED', 'A assinatura não foi identificada.');
  const subscription = await loadInternalSubscription(store.canonicalStoreId, subscriptionId);
  if (subscription.buyerId !== identity.uid) {
    fail(403, 'STORE_SUBSCRIPTION_FORBIDDEN', 'Esta assinatura pertence a outro usuário.');
  }
  return subscription;
};

export const getAuthorizedStoreSubscription = async (
  authorization: string,
  body: unknown
): Promise<StoreSubscriptionSnapshot> =>
  safeSnapshot(await loadAuthorizedSubscription(authorization, body));

export const reconcileAuthorizedStoreSubscription = async (
  authorization: string,
  body: unknown
): Promise<StoreSubscriptionSnapshot> =>
  safeSnapshot(await reconcileInternalSubscription(
    await loadAuthorizedSubscription(authorization, body)
  ));

export const cancelAuthorizedStoreSubscription = async (
  authorization: string,
  body: unknown
): Promise<StoreSubscriptionSnapshot> => {
  const subscription = await loadAuthorizedSubscription(authorization, body);
  if (subscription.state === 'cancelled') return safeSnapshot(subscription);
  const provider = await mercadoPagoStoreRequest<MpPreapproval>(
    subscription.credentialScopeId,
    `/preapproval/${encodeURIComponent(subscription.providerSubscriptionId)}`,
    { method: 'PUT', body: JSON.stringify({ status: 'canceled' }) }
  );
  const confirmed = assertProviderPreapproval(subscription, provider);
  if (confirmed !== 'cancelled') {
    fail(409, 'STORE_SUBSCRIPTION_CANCEL_NOT_CONFIRMED', 'O Mercado Pago ainda não confirmou o cancelamento.');
  }
  return safeSnapshot(await reconcileInternalSubscription(subscription));
};

const reconcileByProviderBinding = async (
  binding: ProviderBinding,
  expectedExternalAccountId: string
): Promise<StoreSubscriptionSnapshot> => {
  if (
    binding.externalAccountId !== expectedExternalAccountId ||
    !binding.credentialScopeId
  ) {
    fail(409, 'STORE_SUBSCRIPTION_WEBHOOK_ACCOUNT_MISMATCH', 'A notificação não pertence à conta vinculada à assinatura.');
  }
  const subscription = await loadInternalSubscription(binding.storeId, binding.subscriptionId);
  if (
    subscription.providerSubscriptionId !== binding.providerSubscriptionId ||
    subscription.credentialScopeId !== binding.credentialScopeId ||
    subscription.externalAccountId !== binding.externalAccountId
  ) {
    fail(409, 'STORE_SUBSCRIPTION_WEBHOOK_BINDING_MISMATCH', 'A notificação não corresponde ao vínculo interno da assinatura.');
  }
  return safeSnapshot(await reconcileInternalSubscription(subscription));
};

export interface StoreSubscriptionWebhookResult {
  accepted: true;
  processed: boolean;
  storeId: string;
  subscriptionId: string;
}

export const processStoreSubscriptionMercadoPagoWebhook = async (input: {
  headers: Record<string, string | string[] | undefined>;
  dataId: string;
  eventType: string;
  userId: string;
}): Promise<StoreSubscriptionWebhookResult> => {
  const dataId = safeIdentity(input.dataId);
  const eventType = clean(input.eventType);
  const userId = safeIdentity(input.userId);
  if (!dataId) {
    fail(400, 'STORE_SUBSCRIPTION_WEBHOOK_DATA_REQUIRED', 'A notificação não contém o recurso do Mercado Pago.');
  }
  if (
    eventType !== 'subscription_preapproval' &&
    eventType !== 'subscription_authorized_payment'
  ) {
    return { accepted: true, processed: false, storeId: '', subscriptionId: '' };
  }

  // The HMAC is checked before user_id is used as a routing hint. Provider
  // state is then re-read with the merchant credential before any state change.
  await verifyMercadoPagoWebhookSignature({ headers: input.headers, dataId });
  if (!userId) {
    fail(409, 'STORE_SUBSCRIPTION_WEBHOOK_USER_REQUIRED', 'A notificação não identifica a conta Mercado Pago recebedora.');
  }

  if (eventType === 'subscription_preapproval') {
    const binding = await loadProviderBinding(dataId);
    if (!binding) return { accepted: true, processed: false, storeId: '', subscriptionId: '' };
    const subscription = await reconcileByProviderBinding(binding, userId);
    return {
      accepted: true,
      processed: true,
      storeId: subscription.storeId,
      subscriptionId: subscription.id,
    };
  }

  const account = await loadAccountBinding(userId);
  if (!account) return { accepted: true, processed: false, storeId: '', subscriptionId: '' };
  const invoice = await mercadoPagoStoreRequest<Record<string, unknown>>(
    account.credentialScopeId,
    `/authorized_payments/${encodeURIComponent(dataId)}`
  );
  const invoiceCollector = safeIdentity(invoice.collector_id);
  if (invoiceCollector && invoiceCollector !== account.externalAccountId) {
    fail(409, 'STORE_SUBSCRIPTION_WEBHOOK_INVOICE_ACCOUNT_MISMATCH', 'A fatura pertence a outra conta Mercado Pago.');
  }
  const providerSubscriptionId = safeIdentity(invoice.preapproval_id);
  if (!providerSubscriptionId) {
    fail(409, 'STORE_SUBSCRIPTION_WEBHOOK_PREAPPROVAL_MISSING', 'A fatura não identifica a assinatura de origem.');
  }

  const binding = await loadProviderBinding(providerSubscriptionId);
  if (!binding) return { accepted: true, processed: false, storeId: '', subscriptionId: '' };
  if (
    binding.credentialScopeId !== account.credentialScopeId ||
    binding.externalAccountId !== account.externalAccountId
  ) {
    fail(409, 'STORE_SUBSCRIPTION_WEBHOOK_ROUTE_MISMATCH', 'A fatura foi roteada para uma conta diferente da assinatura.');
  }
  const subscription = await reconcileByProviderBinding(binding, account.externalAccountId);
  return {
    accepted: true,
    processed: true,
    storeId: subscription.storeId,
    subscriptionId: subscription.id,
  };
};

export const mapStoreSubscriptionError = (
  error: unknown
): { status: number; body: { error: string; code?: string } } => {
  if (error instanceof StoreSubscriptionError) {
    return { status: error.status, body: { error: error.message, code: error.code } };
  }
  const message = error instanceof Error ? error.message : String(error);
  if (message.includes('AUTH_REQUIRED')) {
    return { status: 401, body: { error: 'Faça login novamente para continuar.', code: 'AUTH_REQUIRED' } };
  }
  if (
    message.startsWith('MERCADO_PAGO_SIGNATURE_') ||
    message === 'MERCADO_PAGO_WEBHOOK_NOT_CONFIGURED'
  ) {
    return { status: 401, body: { error: 'Assinatura da notificação inválida.', code: 'INVALID_WEBHOOK_SIGNATURE' } };
  }
  if (message.startsWith('MERCADO_PAGO_STORE_') || message.startsWith('MERCADO_PAGO_OAUTH_')) {
    console.warn('[Store Subscription]', message);
    return {
      status: 502,
      body: {
        error: 'O Mercado Pago da loja não conseguiu processar a assinatura agora.',
        code: 'STORE_SUBSCRIPTION_PROVIDER_ERROR',
      },
    };
  }
  console.error('[Store Subscription]', error);
  return {
    status: 503,
    body: {
      error: 'Não foi possível processar a assinatura agora.',
      code: 'STORE_SUBSCRIPTION_UNAVAILABLE',
    },
  };
};
