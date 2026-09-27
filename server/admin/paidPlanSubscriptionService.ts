import { createHmac, randomUUID, timingSafeEqual } from 'node:crypto';
import { FieldValue, Timestamp } from 'firebase-admin/firestore';
import type { KyrubCommercialPlanId } from '../../shared/kyrubCommercialPlans.js';
import {
  KYRUB_PLAN_BILLING_SCHEMA_VERSION,
  type KyrubPlanBillingAvailability,
  type KyrubPlanCheckoutResult,
  type KyrubPlanSubscriptionSnapshot,
  type KyrubPlanSubscriptionState,
  type KyrubPlanSubscriptionStatus,
} from '../../shared/kyrubPlanBilling.js';
import { authenticateConsultantRequest } from '../ai/consultantAuth.js';
import { adminDb } from '../firebaseAdmin.js';
import { PlanManagementError } from './planManagementService.js';
import { loadPublicActivePlanCatalog } from './publicPlanCatalogService.js';

const ROOT = 'kyrub_admin/control_plane';
const SUBSCRIPTION_COLLECTION = `${ROOT}/store_subscriptions`;
const ENTITLEMENT_COLLECTION = `${ROOT}/store_entitlements`;
const AUDIT_COLLECTION = `${ROOT}/audit_logs`;
const PROVIDER = 'mercado_pago' as const;
const MP_API = 'https://api.mercadopago.com';

const clean = (value: unknown): string => typeof value === 'string' ? value.trim() : '';
const accessToken = (): string => clean(process.env.KYRUB_BILLING_MERCADO_PAGO_ACCESS_TOKEN);
const webhookSecret = (): string => clean(process.env.KYRUB_BILLING_MERCADO_PAGO_WEBHOOK_SECRET);
const webhookUrl = (): string => clean(process.env.KYRUB_PLAN_BILLING_WEBHOOK_URL);
const returnUrl = (): string => clean(process.env.KYRUB_PLAN_BILLING_RETURN_URL) || 'https://planos.kyrub.com/';

export const loadPaidPlanBillingAvailability = (): KyrubPlanBillingAvailability => ({
  available: Boolean(accessToken() && webhookSecret() && webhookUrl()),
  provider: PROVIDER,
});

const requireBillingConfig = (): { token: string; notificationUrl: string } => {
  const token = accessToken();
  const notificationUrl = webhookUrl();
  if (!token || !webhookSecret() || !notificationUrl) {
    throw new PlanManagementError(503, 'PLAN_BILLING_NOT_CONFIGURED', 'A contratação paga ainda não está habilitada para esta instalação.');
  }
  return { token, notificationUrl };
};

const safeOwnerId = (value: unknown): string => {
  const ownerId = clean(value);
  if (!/^[a-zA-Z0-9_-]{1,128}$/.test(ownerId)) {
    throw new PlanManagementError(400, 'INVALID_STORE_OWNER', 'A identidade da loja é inválida.');
  }
  return ownerId;
};

const paidPlan = (value: unknown): 'pro' | 'business' => {
  if (value === 'pro' || value === 'business') return value;
  throw new PlanManagementError(400, 'INVALID_TARGET_PLAN', 'Escolha Pro ou Business.');
};

const timestampIso = (value: unknown): string | null => {
  if (!value) return null;
  if (value instanceof Timestamp) return value.toDate().toISOString();
  if (typeof value === 'string') {
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? null : date.toISOString();
  }
  if (typeof value === 'object' && 'toDate' in value) {
    try { return (value as { toDate(): Date }).toDate().toISOString(); } catch { return null; }
  }
  return null;
};

type MpPreapproval = {
  id?: unknown;
  status?: unknown;
  init_point?: unknown;
};

const providerStatus = (value: unknown): KyrubPlanSubscriptionStatus => {
  if (value === 'authorized' || value === 'paused') return value;
  if (value === 'canceled' || value === 'cancelled') return 'cancelled';
  return 'pending';
};

const mpRequest = async (path: string, init: RequestInit = {}): Promise<Record<string, unknown>> => {
  const { token } = requireBillingConfig();
  const response = await fetch(`${MP_API}${path}`, {
    ...init,
    headers: {
      accept: 'application/json',
      authorization: `Bearer ${token}`,
      'content-type': 'application/json',
      ...(init.headers ?? {}),
    },
  });
  const payload = await response.json().catch(() => null) as Record<string, unknown> | null;
  if (!response.ok || !payload) {
    console.error('[Kyrub Plans] Mercado Pago billing request failed.', response.status, payload);
    throw new PlanManagementError(502, 'PLAN_BILLING_PROVIDER_ERROR', 'O provedor de cobrança não conseguiu processar a assinatura agora.');
  }
  return payload;
};

const findCanonicalStore = async (ownerId: string): Promise<string | null> => {
  const snapshot = await adminDb.collection('stores').where('ownerId', '==', ownerId).get();
  if (snapshot.size > 1) {
    throw new PlanManagementError(409, 'STORE_IDENTITY_CONFLICT', 'Mais de uma loja canônica foi encontrada para este proprietário.');
  }
  return snapshot.empty ? null : snapshot.docs[0].id;
};

const writePlanMirrors = (
  transaction: FirebaseFirestore.Transaction,
  ownerId: string,
  canonicalStoreId: string | null,
  plan: KyrubCommercialPlanId,
  now: FirebaseFirestore.FieldValue
): void => {
  transaction.set(adminDb.doc(`users/${ownerId}/stores/${ownerId}`), { plan, updatedAt: now }, { merge: true });
  transaction.set(adminDb.doc(`tenants/${ownerId}`), { id: ownerId, ownerId, plan, updatedAt: now }, { merge: true });
  if (canonicalStoreId) {
    transaction.set(adminDb.doc(`stores/${canonicalStoreId}`), { plan, legacyTenantId: ownerId, updatedAt: now }, { merge: true });
  }
};

const parseStoredSubscription = (ownerId: string, data?: Record<string, unknown>): KyrubPlanSubscriptionSnapshot | null => {
  if (!data) return null;
  const plan = data.plan === 'business' ? 'business' : data.plan === 'pro' ? 'pro' : null;
  const providerSubscriptionId = clean(data.providerSubscriptionId);
  const planVersion = Number.isInteger(data.planVersion) ? data.planVersion as number : 0;
  const amountMinor = Number.isInteger(data.amountMinor) ? data.amountMinor as number : 0;
  if (!plan || !providerSubscriptionId || planVersion < 1 || amountMinor < 1) return null;
  return {
    schemaVersion: KYRUB_PLAN_BILLING_SCHEMA_VERSION,
    storeId: ownerId,
    ownerId,
    plan,
    planVersion,
    provider: PROVIDER,
    providerSubscriptionId,
    providerStatus: providerStatus(data.providerStatus),
    amountMinor,
    currency: 'BRL',
    checkoutUrl: clean(data.checkoutUrl),
    createdAt: timestampIso(data.createdAt) ?? '',
    updatedAt: timestampIso(data.updatedAt) ?? '',
    activatedAt: timestampIso(data.activatedAt),
    cancelledAt: timestampIso(data.cancelledAt),
  };
};

const assertStoreExists = async (ownerId: string): Promise<void> => {
  const snapshot = await adminDb.doc(`users/${ownerId}/stores/${ownerId}`).get();
  if (!snapshot.exists) throw new PlanManagementError(404, 'STORE_NOT_FOUND', 'Ative sua Loja Kyrub antes de contratar um plano.');
};

const assertSubscriptionCanReplaceEntitlement = async (ownerId: string): Promise<void> => {
  const snapshot = await adminDb.doc(`${ENTITLEMENT_COLLECTION}/${ownerId}`).get();
  if (!snapshot.exists) return;
  const data = snapshot.data() as Record<string, unknown>;
  if (data.status === 'active' && (data.source === 'promotion' || data.source === 'admin_grant')) {
    throw new PlanManagementError(409, 'ACTIVE_PROMOTIONAL_BENEFIT_EXISTS', 'Esta loja possui uma cortesia ou promoção ativa. Aguarde o término antes de iniciar uma assinatura paga.');
  }
};

const selectedPlan = async (targetPlan: 'pro' | 'business') => {
  const catalog = await loadPublicActivePlanCatalog();
  const entry = catalog.plans.find(item => item.planId === targetPlan);
  if (!entry || entry.monthlyPriceBRL <= 0) {
    throw new PlanManagementError(409, 'PLAN_NOT_BILLABLE', 'Este plano não possui preço mensal ativo para contratação.');
  }
  return entry;
};

const activateSubscriptionEntitlement = async (ownerId: string, subscription: KyrubPlanSubscriptionSnapshot): Promise<void> => {
  const canonicalStoreId = await findCanonicalStore(ownerId);
  const entitlementRef = adminDb.doc(`${ENTITLEMENT_COLLECTION}/${ownerId}`);
  const subscriptionRef = adminDb.doc(`${SUBSCRIPTION_COLLECTION}/${ownerId}`);
  await adminDb.runTransaction(async transaction => {
    const existing = await transaction.get(entitlementRef);
    const data = existing.exists ? existing.data() as Record<string, unknown> : {};
    const alreadyActive = data.status === 'active' && data.source === 'subscription' &&
      clean(data.providerSubscriptionId) === subscription.providerSubscriptionId && data.plan === subscription.plan;
    const now = FieldValue.serverTimestamp();
    writePlanMirrors(transaction, ownerId, canonicalStoreId, subscription.plan, now);
    transaction.set(entitlementRef, {
      schemaVersion: 2,
      storeId: ownerId,
      ownerId,
      plan: subscription.plan,
      planVersion: subscription.planVersion,
      source: 'subscription',
      status: 'active',
      benefitStartsAt: data.benefitStartsAt ?? now,
      benefitEndsAt: null,
      provider: PROVIDER,
      providerSubscriptionId: subscription.providerSubscriptionId,
      updatedAt: now,
    });
    transaction.set(subscriptionRef, { providerStatus: 'authorized', activatedAt: data.activatedAt ?? now, cancelledAt: null, updatedAt: now }, { merge: true });
    if (!alreadyActive) {
      const auditRef = adminDb.doc(`${AUDIT_COLLECTION}/${randomUUID().replaceAll('-', '_')}`);
      transaction.set(auditRef, {
        id: auditRef.id,
        action: 'store.subscription.activated',
        actorId: 'kyrub_billing',
        actorRole: 'system',
        targetType: 'store',
        targetId: ownerId,
        previousPlan: clean(data.plan) || 'free',
        nextPlan: subscription.plan,
        provider: PROVIDER,
        providerSubscriptionId: subscription.providerSubscriptionId,
        source: 'server',
        createdAt: now,
      });
    }
  });
};

const deactivateSubscriptionEntitlement = async (
  ownerId: string,
  providerSubscriptionId: string,
  status: 'paused' | 'cancelled'
): Promise<void> => {
  const canonicalStoreId = await findCanonicalStore(ownerId);
  const entitlementRef = adminDb.doc(`${ENTITLEMENT_COLLECTION}/${ownerId}`);
  const subscriptionRef = adminDb.doc(`${SUBSCRIPTION_COLLECTION}/${ownerId}`);
  await adminDb.runTransaction(async transaction => {
    const existing = await transaction.get(entitlementRef);
    const data = existing.exists ? existing.data() as Record<string, unknown> : {};
    const owns = data.source === 'subscription' && clean(data.providerSubscriptionId) === providerSubscriptionId;
    const wasActive = owns && data.status === 'active';
    const now = FieldValue.serverTimestamp();
    if (owns) {
      writePlanMirrors(transaction, ownerId, canonicalStoreId, 'free', now);
      transaction.set(entitlementRef, { status: 'revoked', revokedAt: now, updatedAt: now }, { merge: true });
    }
    transaction.set(subscriptionRef, {
      providerStatus: status,
      ...(status === 'cancelled' ? { cancelledAt: now } : {}),
      updatedAt: now,
    }, { merge: true });
    if (wasActive) {
      const auditRef = adminDb.doc(`${AUDIT_COLLECTION}/${randomUUID().replaceAll('-', '_')}`);
      transaction.set(auditRef, {
        id: auditRef.id,
        action: status === 'cancelled' ? 'store.subscription.cancelled' : 'store.subscription.paused',
        actorId: 'kyrub_billing',
        actorRole: 'system',
        targetType: 'store',
        targetId: ownerId,
        previousPlan: clean(data.plan) || null,
        nextPlan: 'free',
        provider: PROVIDER,
        providerSubscriptionId,
        source: 'server',
        createdAt: now,
      });
    }
  });
};

const persistProviderState = async (
  ownerId: string,
  provider: MpPreapproval,
  fallback: KyrubPlanSubscriptionSnapshot
): Promise<void> => {
  const status = providerStatus(provider.status);
  await adminDb.doc(`${SUBSCRIPTION_COLLECTION}/${ownerId}`).set({
    providerStatus: status,
    checkoutUrl: clean(provider.init_point) || fallback.checkoutUrl,
    updatedAt: FieldValue.serverTimestamp(),
  }, { merge: true });
  const next: KyrubPlanSubscriptionSnapshot = {
    ...fallback,
    providerStatus: status,
    checkoutUrl: clean(provider.init_point) || fallback.checkoutUrl,
    updatedAt: new Date().toISOString(),
  };
  if (status === 'authorized') await activateSubscriptionEntitlement(ownerId, next);
  if (status === 'paused' || status === 'cancelled') {
    await deactivateSubscriptionEntitlement(ownerId, fallback.providerSubscriptionId, status);
  }
};

export const loadOwnPlanSubscriptionState = async (authorization: string): Promise<KyrubPlanSubscriptionState> => {
  const user = await authenticateConsultantRequest(authorization);
  const ownerId = safeOwnerId(user.uid);
  const snapshot = await adminDb.doc(`${SUBSCRIPTION_COLLECTION}/${ownerId}`).get();
  return {
    billing: loadPaidPlanBillingAvailability(),
    subscription: parseStoredSubscription(ownerId, snapshot.exists ? snapshot.data() as Record<string, unknown> : undefined),
  };
};

export const createOwnPaidPlanCheckout = async (authorization: string, rawPlan: unknown): Promise<KyrubPlanCheckoutResult> => {
  const user = await authenticateConsultantRequest(authorization);
  const ownerId = safeOwnerId(user.uid);
  const targetPlan = paidPlan(rawPlan);
  const config = requireBillingConfig();
  if (!clean(user.email) || user.emailVerified === false) {
    throw new PlanManagementError(409, 'BILLING_EMAIL_REQUIRED', 'Sua conta precisa ter um e-mail válido para iniciar a assinatura.');
  }
  await assertStoreExists(ownerId);
  await assertSubscriptionCanReplaceEntitlement(ownerId);
  const plan = await selectedPlan(targetPlan);
  const existingSnapshot = await adminDb.doc(`${SUBSCRIPTION_COLLECTION}/${ownerId}`).get();
  const existing = parseStoredSubscription(ownerId, existingSnapshot.exists ? existingSnapshot.data() as Record<string, unknown> : undefined);
  if (existing && existing.providerStatus !== 'cancelled') {
    const provider = await mpRequest(`/preapproval/${encodeURIComponent(existing.providerSubscriptionId)}`) as MpPreapproval;
    await persistProviderState(ownerId, provider, existing);
    const refreshed = providerStatus(provider.status);
    if (refreshed !== 'cancelled') {
      throw new PlanManagementError(409, 'ACTIVE_SUBSCRIPTION_EXISTS', 'Esta loja já possui uma assinatura em andamento.');
    }
  }

  const billingReference = randomUUID().replaceAll('-', '_');
  const provider = await mpRequest('/preapproval', {
    method: 'POST',
    body: JSON.stringify({
      reason: `Kyrub ${targetPlan === 'business' ? 'Business' : 'Pro'}`,
      external_reference: billingReference,
      payer_email: user.email,
      auto_recurring: {
        frequency: 1,
        frequency_type: 'months',
        transaction_amount: plan.monthlyPriceBRL,
        currency_id: 'BRL',
      },
      back_url: returnUrl(),
      notification_url: config.notificationUrl,
      status: 'pending',
    }),
  }) as MpPreapproval;
  const providerSubscriptionId = clean(provider.id);
  const checkoutUrl = clean(provider.init_point);
  if (!providerSubscriptionId || !checkoutUrl) {
    throw new PlanManagementError(502, 'PLAN_BILLING_PROVIDER_INVALID', 'O provedor não retornou um checkout válido.');
  }
  const now = new Date().toISOString();
  const subscription: KyrubPlanSubscriptionSnapshot = {
    schemaVersion: KYRUB_PLAN_BILLING_SCHEMA_VERSION,
    storeId: ownerId,
    ownerId,
    plan: targetPlan,
    planVersion: plan.version,
    provider: PROVIDER,
    providerSubscriptionId,
    providerStatus: providerStatus(provider.status),
    amountMinor: Math.round(plan.monthlyPriceBRL * 100),
    currency: 'BRL',
    checkoutUrl,
    createdAt: now,
    updatedAt: now,
    activatedAt: null,
    cancelledAt: null,
  };
  await adminDb.doc(`${SUBSCRIPTION_COLLECTION}/${ownerId}`).set({
    ...subscription,
    billingReference,
    payerEmail: user.email,
    createdAt: FieldValue.serverTimestamp(),
    updatedAt: FieldValue.serverTimestamp(),
  });
  return { checkoutUrl, subscription };
};

export const reconcileOwnPaidPlanSubscription = async (authorization: string): Promise<KyrubPlanSubscriptionState> => {
  const user = await authenticateConsultantRequest(authorization);
  const ownerId = safeOwnerId(user.uid);
  const snapshot = await adminDb.doc(`${SUBSCRIPTION_COLLECTION}/${ownerId}`).get();
  const subscription = parseStoredSubscription(ownerId, snapshot.exists ? snapshot.data() as Record<string, unknown> : undefined);
  if (!subscription) return { billing: loadPaidPlanBillingAvailability(), subscription: null };
  const provider = await mpRequest(`/preapproval/${encodeURIComponent(subscription.providerSubscriptionId)}`) as MpPreapproval;
  await persistProviderState(ownerId, provider, subscription);
  return loadOwnPlanSubscriptionState(authorization);
};

export const cancelOwnPaidPlanSubscription = async (authorization: string): Promise<KyrubPlanSubscriptionState> => {
  const user = await authenticateConsultantRequest(authorization);
  const ownerId = safeOwnerId(user.uid);
  const snapshot = await adminDb.doc(`${SUBSCRIPTION_COLLECTION}/${ownerId}`).get();
  const subscription = parseStoredSubscription(ownerId, snapshot.exists ? snapshot.data() as Record<string, unknown> : undefined);
  if (!subscription) throw new PlanManagementError(404, 'SUBSCRIPTION_NOT_FOUND', 'Nenhuma assinatura paga foi encontrada para esta loja.');
  const provider = await mpRequest(`/preapproval/${encodeURIComponent(subscription.providerSubscriptionId)}`, {
    method: 'PUT',
    body: JSON.stringify({ status: 'canceled' }),
  }) as MpPreapproval;
  if (providerStatus(provider.status) !== 'cancelled') {
    throw new PlanManagementError(502, 'PLAN_BILLING_CANCEL_NOT_CONFIRMED', 'O Mercado Pago não confirmou o cancelamento da assinatura.');
  }
  await persistProviderState(ownerId, provider, subscription);
  return loadOwnPlanSubscriptionState(authorization);
};

const headerValue = (value: string | string[] | undefined): string => Array.isArray(value) ? value[0] ?? '' : value ?? '';

export const verifyPaidPlanWebhookSignature = (input: {
  signature: string | string[] | undefined;
  requestId: string | string[] | undefined;
  dataId: string;
}): boolean => {
  const secret = webhookSecret();
  if (!secret) return false;
  const signature = headerValue(input.signature);
  const ts = /(?:^|,)ts=([^,]+)/.exec(signature)?.[1]?.trim() ?? '';
  const supplied = /(?:^|,)v1=([^,]+)/.exec(signature)?.[1]?.trim() ?? '';
  const requestId = headerValue(input.requestId).trim();
  const dataId = clean(input.dataId).toLowerCase();
  if (!ts || !supplied || !requestId || !dataId) return false;
  const expected = createHmac('sha256', secret)
    .update(`id:${dataId};request-id:${requestId};ts:${ts};`)
    .digest('hex');
  const left = Buffer.from(expected, 'utf8');
  const right = Buffer.from(supplied, 'utf8');
  return left.length === right.length && timingSafeEqual(left, right);
};

export const handlePaidPlanProviderWebhook = async (input: {
  signature: string | string[] | undefined;
  requestId: string | string[] | undefined;
  dataId: string;
}): Promise<{ accepted: true }> => {
  if (!verifyPaidPlanWebhookSignature(input)) {
    throw new PlanManagementError(401, 'INVALID_BILLING_WEBHOOK_SIGNATURE', 'Assinatura do webhook inválida.');
  }
  const providerSubscriptionId = clean(input.dataId);
  const matches = await adminDb.collection(SUBSCRIPTION_COLLECTION)
    .where('providerSubscriptionId', '==', providerSubscriptionId)
    .limit(2)
    .get();
  if (matches.size > 1) {
    throw new PlanManagementError(409, 'SUBSCRIPTION_IDENTITY_CONFLICT', 'A assinatura do provedor está vinculada a mais de uma loja.');
  }
  if (matches.empty) return { accepted: true };
  const ownerId = matches.docs[0].id;
  const subscription = parseStoredSubscription(ownerId, matches.docs[0].data() as Record<string, unknown>);
  if (!subscription) return { accepted: true };
  const provider = await mpRequest(`/preapproval/${encodeURIComponent(providerSubscriptionId)}`) as MpPreapproval;
  await persistProviderState(ownerId, provider, subscription);
  return { accepted: true };
};
