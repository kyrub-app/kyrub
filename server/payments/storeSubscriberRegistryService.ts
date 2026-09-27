import { adminDb } from '../firebaseAdmin.js';
import { authenticateConsultantRequest } from '../ai/consultantAuth.js';
import {
  parseProductSaleModality,
  type ProductSubscriptionTerms,
} from '../../shared/productSaleModality.js';
import type {
  StoreSubscriptionProviderStatus,
  StoreSubscriptionState,
} from '../../shared/storeSubscriptionBilling.js';
import {
  STORE_SUBSCRIBER_REGISTRY_SCHEMA_VERSION,
  type StoreSubscriberCrmReconciliationResult,
  type StoreSubscriberRegistrySummary,
  type StoreSubscriberSubscriptionSummary,
  type StoreSubscriberSummary,
} from '../../shared/storeSubscriberRegistry.js';

const clean = (value: unknown): string =>
  typeof value === 'string' || typeof value === 'number' ? String(value).trim() : '';
const record = (value: unknown): Record<string, unknown> =>
  value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
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
const validIso = (value: unknown): string => {
  const normalized = clean(value);
  return normalized && Number.isFinite(Date.parse(normalized)) ? normalized : '';
};
const maxIso = (values: string[]): string =>
  values.filter(Boolean).sort((left, right) => right.localeCompare(left))[0] ?? '';
const minIso = (values: string[]): string =>
  values.filter(Boolean).sort((left, right) => left.localeCompare(right))[0] ?? '';

export class StoreSubscriberRegistryError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: string,
    message: string
  ) {
    super(message);
    this.name = 'StoreSubscriberRegistryError';
  }
}

const fail = (status: number, code: string, message: string): never => {
  throw new StoreSubscriberRegistryError(status, code, message);
};

interface OwnedCanonicalStore {
  canonicalStoreId: string;
  ownerUserId: string;
  legacyStoreId: string;
}

interface CanonicalSubscriptionRelationship {
  id: string;
  storeId: string;
  buyerId: string;
  buyerEmail: string;
  productId: string;
  productName: string;
  amountMinor: number;
  currency: 'BRL';
  state: StoreSubscriptionState;
  providerStatus: StoreSubscriptionProviderStatus;
  terms: ProductSubscriptionTerms;
  createdAt: string;
  updatedAt: string;
  activatedAt: string;
  cancelledAt: string;
  paymentConfirmedAt: string;
}

const resolveOwnedCanonicalStore = async (
  authorization: string,
  storeReference: unknown
): Promise<OwnedCanonicalStore> => {
  const identity = await authenticateConsultantRequest(authorization);
  const input = safeIdentity(storeReference);
  if (!input) {
    fail(400, 'STORE_SUBSCRIBER_STORE_REQUIRED', 'A loja não foi identificada.');
  }

  const direct = await adminDb.doc(`stores/${input}`).get();
  let canonical = direct;
  if (!direct.exists) {
    const matches = await adminDb
      .collection('stores')
      .where('legacyTenantId', '==', input)
      .limit(2)
      .get();
    if (matches.empty) {
      fail(404, 'STORE_SUBSCRIBER_STORE_NOT_FOUND', 'A loja não foi encontrada.');
    }
    if (matches.size !== 1) {
      fail(409, 'STORE_SUBSCRIBER_STORE_AMBIGUOUS', 'A identidade da loja está ambígua.');
    }
    canonical = matches.docs[0];
  }

  const data = record(canonical.data());
  const canonicalStoreId = safeIdentity(canonical.id);
  const ownerUserId = safeIdentity(data.ownerId);
  const legacyStoreId = safeIdentity(data.legacyTenantId) || ownerUserId;
  if (!canonicalStoreId || !ownerUserId || !legacyStoreId) {
    fail(409, 'STORE_SUBSCRIBER_STORE_IDENTITY_INVALID', 'A identidade da loja está inconsistente.');
  }
  if (identity.uid !== ownerUserId) {
    fail(403, 'STORE_SUBSCRIBER_FORBIDDEN', 'Apenas o proprietário da loja pode consultar os assinantes.');
  }
  return { canonicalStoreId, ownerUserId, legacyStoreId };
};

const parseState = (value: unknown): StoreSubscriptionState | null => {
  if (
    value === 'pending' ||
    value === 'active' ||
    value === 'payment_due' ||
    value === 'paused' ||
    value === 'cancelled'
  ) return value;
  return null;
};

const parseProviderStatus = (value: unknown): StoreSubscriptionProviderStatus | null => {
  if (
    value === 'pending' ||
    value === 'authorized' ||
    value === 'paused' ||
    value === 'cancelled'
  ) return value;
  return null;
};

const parseCanonicalSubscription = (
  data: Record<string, unknown>,
  documentId: string,
  storeId: string
): CanonicalSubscriptionRelationship | null => {
  const id = safeIdentity(data.id) || safeIdentity(documentId);
  const buyerId = safeIdentity(data.buyerId);
  const buyerEmail = validEmail(data.buyerEmail);
  const productId = safeIdentity(data.productId);
  const productName = clean(data.productName);
  const amountMinor = Number(data.amountMinor);
  const state = parseState(data.state);
  const providerStatus = parseProviderStatus(data.providerStatus);
  const modality = parseProductSaleModality(data.saleModality);
  if (
    data.schemaVersion !== 1 ||
    clean(data.storeId) !== storeId ||
    !id || !buyerId || !productId || !productName ||
    !Number.isInteger(amountMinor) || amountMinor <= 0 ||
    clean(data.currency) !== 'BRL' ||
    !state || !providerStatus ||
    !modality || modality.mode !== 'subscription' || !modality.subscription
  ) return null;

  return {
    id,
    storeId,
    buyerId,
    buyerEmail,
    productId,
    productName,
    amountMinor,
    currency: 'BRL',
    state,
    providerStatus,
    terms: modality.subscription,
    createdAt: validIso(data.createdAt),
    updatedAt: validIso(data.updatedAt),
    activatedAt: validIso(data.activatedAt),
    cancelledAt: validIso(data.cancelledAt),
    paymentConfirmedAt: validIso(data.paymentConfirmedAt),
  };
};

const loadCanonicalSubscriptions = async (
  storeId: string
): Promise<CanonicalSubscriptionRelationship[]> => {
  const snapshot = await adminDb.collection(`stores/${storeId}/subscriptions`).get();
  return snapshot.docs
    .map(doc => parseCanonicalSubscription(record(doc.data()), doc.id, storeId))
    .filter((subscription): subscription is CanonicalSubscriptionRelationship => subscription !== null);
};

const byBuyer = (
  subscriptions: CanonicalSubscriptionRelationship[]
): Map<string, CanonicalSubscriptionRelationship[]> => {
  const grouped = new Map<string, CanonicalSubscriptionRelationship[]>();
  for (const subscription of subscriptions) {
    const current = grouped.get(subscription.buyerId) ?? [];
    current.push(subscription);
    grouped.set(subscription.buyerId, current);
  }
  return grouped;
};

const publicSubscription = (
  subscription: CanonicalSubscriptionRelationship
): StoreSubscriberSubscriptionSummary => ({
  id: subscription.id,
  productId: subscription.productId,
  productName: subscription.productName,
  amountMinor: subscription.amountMinor,
  currency: 'BRL',
  state: subscription.state,
  providerStatus: subscription.providerStatus,
  terms: subscription.terms,
  createdAt: subscription.createdAt,
  updatedAt: subscription.updatedAt,
  activatedAt: subscription.activatedAt,
  cancelledAt: subscription.cancelledAt,
  paymentConfirmedAt: subscription.paymentConfirmedAt,
});

const loadCustomerIdentity = async (
  storeId: string,
  buyerId: string,
  subscriptions: CanonicalSubscriptionRelationship[]
): Promise<{ displayName: string; email: string; photoUrl: string }> => {
  const [profileSnapshot, crmSnapshot] = await Promise.all([
    adminDb.doc(`users/${buyerId}`).get(),
    adminDb.doc(`stores/${storeId}/crmCustomers/${buyerId}`).get(),
  ]);
  const profile = record(profileSnapshot.data());
  const crm = record(crmSnapshot.data());
  const orderIdentity = record(crm.orderIdentity);
  const subscriptionIdentity = record(crm.subscriptionIdentity);
  const latest = [...subscriptions].sort((left, right) =>
    (right.updatedAt || right.createdAt).localeCompare(left.updatedAt || left.createdAt)
  )[0];
  const email =
    validEmail(latest?.buyerEmail) ||
    validEmail(subscriptionIdentity.email) ||
    validEmail(orderIdentity.email) ||
    validEmail(profile.email);
  const displayName =
    clean(subscriptionIdentity.displayName) ||
    clean(orderIdentity.displayName) ||
    clean(profile.displayName) ||
    clean(profile.name) ||
    (email ? email.split('@')[0] ?? '' : 'Assinante Kyrub');
  const photoUrl =
    clean(profile.photoURL) || clean(profile.photoUrl) || clean(profile.avatarUrl);
  return { displayName, email, photoUrl };
};

const subscriberSummary = async (
  storeId: string,
  buyerId: string,
  subscriptions: CanonicalSubscriptionRelationship[]
): Promise<StoreSubscriberSummary> => {
  const identity = await loadCustomerIdentity(storeId, buyerId, subscriptions);
  const ordered = [...subscriptions].sort((left, right) =>
    (right.updatedAt || right.createdAt).localeCompare(left.updatedAt || left.createdAt)
  );
  const count = (state: StoreSubscriptionState): number =>
    subscriptions.filter(subscription => subscription.state === state).length;
  return {
    customerId: buyerId,
    ...identity,
    subscriptionCount: subscriptions.length,
    pendingSubscriptions: count('pending'),
    activeSubscriptions: count('active'),
    paymentDueSubscriptions: count('payment_due'),
    pausedSubscriptions: count('paused'),
    cancelledSubscriptions: count('cancelled'),
    firstSubscribedAt: minIso(subscriptions.map(subscription => subscription.createdAt)),
    lastActivityAt: maxIso(
      subscriptions.map(subscription => subscription.updatedAt || subscription.createdAt)
    ),
    subscriptions: ordered.map(publicSubscription),
  };
};

export const loadAuthorizedStoreSubscriberRegistry = async (
  authorization: string,
  storeReference: unknown
): Promise<StoreSubscriberRegistrySummary> => {
  const store = await resolveOwnedCanonicalStore(authorization, storeReference);
  const subscriptions = await loadCanonicalSubscriptions(store.canonicalStoreId);
  const subscribers = await Promise.all(
    Array.from(byBuyer(subscriptions).entries()).map(([buyerId, relationships]) =>
      subscriberSummary(store.canonicalStoreId, buyerId, relationships)
    )
  );
  subscribers.sort((left, right) =>
    right.lastActivityAt.localeCompare(left.lastActivityAt) ||
    left.customerId.localeCompare(right.customerId)
  );
  return {
    schemaVersion: STORE_SUBSCRIBER_REGISTRY_SCHEMA_VERSION,
    storeId: store.canonicalStoreId,
    generatedAt: new Date().toISOString(),
    subscriberCount: subscribers.length,
    activeSubscriberCount: subscribers.filter(subscriber => subscriber.activeSubscriptions > 0).length,
    paymentDueSubscriberCount: subscribers.filter(subscriber => subscriber.paymentDueSubscriptions > 0).length,
    subscribers,
  };
};

const defaultMarketingConsent = () => ({
  whatsapp: { status: 'unknown' as const },
  email: { status: 'unknown' as const },
  sms: { status: 'unknown' as const },
});

const hasPaidRelationship = (subscription: CanonicalSubscriptionRelationship): boolean =>
  Boolean(subscription.paymentConfirmedAt || subscription.activatedAt);

const syncPaidSubscriberIntoCrm = async (input: {
  storeId: string;
  buyerId: string;
  subscriptions: CanonicalSubscriptionRelationship[];
  nowIso: string;
}): Promise<boolean> => {
  const paid = input.subscriptions.filter(hasPaidRelationship);
  if (paid.length === 0) return false;
  const identity = await loadCustomerIdentity(input.storeId, input.buyerId, paid);
  const ordered = [...paid].sort((left, right) =>
    (left.createdAt || left.updatedAt).localeCompare(right.createdAt || right.updatedAt)
  );
  const first = ordered[0];
  const last = [...paid].sort((left, right) =>
    (right.updatedAt || right.createdAt).localeCompare(left.updatedAt || left.createdAt)
  )[0] ?? first;
  const reference = adminDb.doc(`stores/${input.storeId}/crmCustomers/${input.buyerId}`);
  const existing = await reference.get();
  const count = (state: StoreSubscriptionState): number =>
    paid.filter(subscription => subscription.state === state).length;

  await reference.set({
    schemaVersion: 1,
    storeId: input.storeId,
    customerId: input.buyerId,
    subscriptionIdentity: {
      displayName: identity.displayName,
      email: identity.email,
    },
    subscriptionStats: {
      firstSubscriptionId: first.id,
      firstSubscriptionAt: first.createdAt || first.paymentConfirmedAt,
      lastSubscriptionId: last.id,
      lastSubscriptionAt: last.updatedAt || last.paymentConfirmedAt || last.createdAt,
      subscriptionCount: paid.length,
      activeSubscriptionCount: count('active'),
      paymentDueSubscriptionCount: count('payment_due'),
      pausedSubscriptionCount: count('paused'),
      cancelledSubscriptionCount: count('cancelled'),
    },
    ...(existing.exists
      ? {}
      : {
          marketingConsent: defaultMarketingConsent(),
          createdAt: input.nowIso,
        }),
    updatedAt: input.nowIso,
  }, { merge: true });
  return true;
};

export const reconcileAuthorizedStoreSubscribersIntoCrm = async (
  authorization: string,
  storeReference: unknown
): Promise<StoreSubscriberCrmReconciliationResult> => {
  const store = await resolveOwnedCanonicalStore(authorization, storeReference);
  const subscriptions = await loadCanonicalSubscriptions(store.canonicalStoreId);
  const groups = byBuyer(subscriptions);
  const now = new Date().toISOString();
  let customersSynced = 0;
  let paidRelationshipCount = 0;
  for (const [buyerId, relationships] of groups) {
    const paid = relationships.filter(hasPaidRelationship);
    paidRelationshipCount += paid.length;
    if (await syncPaidSubscriberIntoCrm({
      storeId: store.canonicalStoreId,
      buyerId,
      subscriptions: relationships,
      nowIso: now,
    })) {
      customersSynced += 1;
    }
  }
  return {
    storeId: store.canonicalStoreId,
    canonicalSubscriptionCount: subscriptions.length,
    paidRelationshipCount,
    customersSynced,
  };
};

export const mapStoreSubscriberRegistryError = (
  error: unknown
): { status: number; body: { error: string; code?: string } } => {
  if (error instanceof StoreSubscriberRegistryError) {
    return { status: error.status, body: { error: error.message, code: error.code } };
  }
  const message = error instanceof Error ? error.message : String(error);
  if (message.includes('AUTH_REQUIRED')) {
    return { status: 401, body: { error: 'Faça login novamente para continuar.', code: 'AUTH_REQUIRED' } };
  }
  console.error('[Store Subscriber Registry]', error);
  return {
    status: 503,
    body: {
      error: 'Não foi possível carregar os assinantes da loja agora.',
      code: 'STORE_SUBSCRIBER_REGISTRY_UNAVAILABLE',
    },
  };
};
