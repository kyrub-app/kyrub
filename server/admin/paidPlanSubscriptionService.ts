import { decideReservationCompletion } from './planReservationDecision.js';
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
import { getOfficialStoreIdentity } from './officialStoreService.js';
import { resolvePersistedProductCheckoutRoute } from './officialPlanProductLookup.js';

const ROOT = 'kyrub_admin/control_plane';
const SUBSCRIPTION_COLLECTION = `${ROOT}/store_subscriptions`;
const ENTITLEMENT_COLLECTION = `${ROOT}/store_entitlements`;
const AUDIT_COLLECTION = `${ROOT}/audit_logs`;
const PROVIDER = 'mercado_pago' as const;
const MP_API = 'https://api.mercadopago.com';

const clean = (value: unknown): string => typeof value === 'string' ? value.trim() : '';
const scalar = (value: unknown): string =>
  typeof value === 'string' || typeof value === 'number' ? String(value).trim() : '';
const record = (value: unknown): Record<string, unknown> =>
  value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
const accessToken = (): string => clean(process.env.KYRUB_BILLING_MERCADO_PAGO_ACCESS_TOKEN);
const webhookSecret = (): string => clean(process.env.KYRUB_BILLING_MERCADO_PAGO_WEBHOOK_SECRET);
const webhookUrl = (): string => clean(process.env.KYRUB_PLAN_BILLING_WEBHOOK_URL);
// Keep an explicitly configured return URL for existing deployments; never default to the retired Plan Center.
const returnUrl = (): string => clean(process.env.KYRUB_PLAN_BILLING_RETURN_URL) || 'https://www.kyrub.com/?app=1';

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

type ApprovedPaymentEvidence = {
  invoiceId: string;
  paymentId: string;
  status: 'approved';
  statusDetail: 'accredited';
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

const loadApprovedSubscriptionPayment = async (
  subscription: KyrubPlanSubscriptionSnapshot
): Promise<ApprovedPaymentEvidence | null> => {
  const payload = await mpRequest(
    `/authorized_payments/search?preapproval_id=${encodeURIComponent(subscription.providerSubscriptionId)}`
  );
  const results = Array.isArray(payload.results) ? payload.results : [];
  for (const raw of results) {
    const invoice = record(raw);
    const payment = record(invoice.payment);
    const amount = Number(invoice.transaction_amount);
    const amountMinor = Number.isFinite(amount) ? Math.round(amount * 100) : 0;
    if (scalar(invoice.preapproval_id) !== subscription.providerSubscriptionId) continue;
    if (scalar(invoice.currency_id) !== subscription.currency) continue;
    if (amountMinor !== subscription.amountMinor) continue;
    if (scalar(payment.status) !== 'approved' || scalar(payment.status_detail) !== 'accredited') continue;
    const invoiceId = scalar(invoice.id);
    const paymentId = scalar(payment.id);
    if (!invoiceId || !paymentId) continue;
    return {
      invoiceId,
      paymentId,
      status: 'approved',
      statusDetail: 'accredited',
    };
  }
  return null;
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

const selectedPlan = async (targetPlan: 'pro' | 'business', productId: string) => {
  const official = await getOfficialStoreIdentity();
  if (!official?.canonicalStoreId) {
    throw new PlanManagementError(409, 'OFFICIAL_STORE_NOT_CONFIGURED', 'Loja Oficial nao configurada.');
  }
  const route = await resolvePersistedProductCheckoutRoute({
    sellerStoreReference: official.canonicalStoreId,
    productId,
  });
  if (route.kind !== 'platform-plan' || route.plan !== targetPlan) {
    throw new PlanManagementError(409, 'OFFICIAL_PLAN_PRODUCT_MISMATCH', 'Produto nao corresponde ao plano contratado.');
  }
  const catalog = await loadPublicActivePlanCatalog();
  const entry = catalog.plans.find(item => item.planId === targetPlan);
  // Governance catalog supplies entitlement version and limits, not the commercial charge.
  if (!entry) {
    throw new PlanManagementError(409, 'PLAN_NOT_BILLABLE', 'Este plano não possui preço mensal ativo para contratação.');
  }
  const product = await adminDb.doc(`stores/${official.canonicalStoreId}/products/${productId}`).get();
  const productData = product.data();
  if (!product.exists || productData?.publicationStatus !== 'published' || productData?.contractDiscounts !== undefined) {
    throw new PlanManagementError(409, 'OFFICIAL_PLAN_PRODUCT_CHANGED', 'Produto oficial indisponivel ou com condicoes contratuais.');
  }
  const price = productData.price;
  if (typeof price !== 'number' || !Number.isFinite(price) || price <= 0 ||
      !Number.isSafeInteger(Math.round(price * 100)) ||
      Math.abs(price * 100 - Math.round(price * 100)) > 1e-7) {
    throw new PlanManagementError(409, 'INVALID_OFFICIAL_PLAN_PRICE', 'Preco comercial invalido.');
  }
  return { ...entry, monthlyPriceBRL: price };
};

const activateSubscriptionEntitlement = async (ownerId: string, subscription: KyrubPlanSubscriptionSnapshot): Promise<void> => {
  const canonicalStoreId = await findCanonicalStore(ownerId);
  const entitlementRef = adminDb.doc(`${ENTITLEMENT_COLLECTION}/${ownerId}`);
  const subscriptionRef = adminDb.doc(`${SUBSCRIPTION_COLLECTION}/${ownerId}`);
  await adminDb.runTransaction(async transaction => {
    const currentSubscription = await transaction.get(subscriptionRef);
    if (currentSubscription.data()?.checkoutReservationStatus === 'pending' ||
        clean(currentSubscription.data()?.providerSubscriptionId) !== subscription.providerSubscriptionId) {
      throw new PlanManagementError(409, 'SUBSCRIPTION_IDENTITY_CONFLICT', 'Assinatura alterada antes da ativacao do plano.');
    }
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
    const currentSubscription = await transaction.get(subscriptionRef);
    if (currentSubscription.data()?.checkoutReservationStatus === 'pending' ||
        clean(currentSubscription.data()?.providerSubscriptionId) !== providerSubscriptionId) {
      throw new PlanManagementError(409, 'SUBSCRIPTION_IDENTITY_CONFLICT', 'Assinatura alterada antes da revogacao do plano.');
    }
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
  const paymentEvidence = status === 'authorized'
    ? await loadApprovedSubscriptionPayment(fallback)
    : null;
  const subscriptionRef = adminDb.doc(`${SUBSCRIPTION_COLLECTION}/${ownerId}`);
  await adminDb.runTransaction(async transaction => {
    const current = await transaction.get(subscriptionRef);
    if (current.data()?.checkoutReservationStatus === 'pending' ||
        clean(current.data()?.providerSubscriptionId) !== fallback.providerSubscriptionId) {
      throw new PlanManagementError(409, 'SUBSCRIPTION_IDENTITY_CONFLICT', 'Assinatura alterada durante a conciliacao; nenhuma atualizacao foi aplicada.');
    }
    transaction.set(subscriptionRef, {
    providerStatus: status,
    checkoutUrl: clean(provider.init_point) || fallback.checkoutUrl,
    ...(status === 'authorized'
      ? paymentEvidence
        ? {
            providerInvoiceId: paymentEvidence.invoiceId,
            providerPaymentId: paymentEvidence.paymentId,
            providerPaymentStatus: paymentEvidence.status,
            providerPaymentStatusDetail: paymentEvidence.statusDetail,
            paymentConfirmedAt: FieldValue.serverTimestamp(),
          }
        : {
            providerPaymentStatus: 'pending_confirmation',
            providerPaymentStatusDetail: null,
          }
      : {}),
    updatedAt: FieldValue.serverTimestamp(),
    }, { merge: true });
  });
  const next: KyrubPlanSubscriptionSnapshot = {
    ...fallback,
    providerStatus: status,
    checkoutUrl: clean(provider.init_point) || fallback.checkoutUrl,
    updatedAt: new Date().toISOString(),
  };
  if (status === 'authorized' && paymentEvidence) {
    await activateSubscriptionEntitlement(ownerId, next);
  }
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
    subscription: snapshot.data()?.checkoutReservationStatus === 'pending'
      ? null
      : parseStoredSubscription(ownerId, snapshot.exists ? snapshot.data() as Record<string, unknown> : undefined),
  };
};

export const createOwnPaidPlanCheckout = async (authorization: string, rawPlan: unknown, rawProductId?: unknown): Promise<KyrubPlanCheckoutResult> => {
  const user = await authenticateConsultantRequest(authorization);
  const ownerId = safeOwnerId(user.uid);
  const targetPlan = paidPlan(rawPlan);
  const officialProductId = typeof rawProductId === 'string' ? rawProductId.trim() : '';
  if (!/^[a-zA-Z0-9_-]{1,128}$/.test(officialProductId)) {
    throw new PlanManagementError(409, 'OFFICIAL_PRODUCT_REQUIRED', 'Selecione o produto de assinatura na Loja Oficial.');
  }
  const config = requireBillingConfig();
  if (!clean(user.email) || user.emailVerified === false) {
    throw new PlanManagementError(409, 'BILLING_EMAIL_REQUIRED', 'Sua conta precisa ter um e-mail válido para iniciar a assinatura.');
  }
  await assertStoreExists(ownerId);
  await assertSubscriptionCanReplaceEntitlement(ownerId);
  const plan = await selectedPlan(targetPlan, officialProductId);
  const official = await getOfficialStoreIdentity();
  if (!official?.canonicalStoreId) {
    throw new PlanManagementError(409, 'OFFICIAL_STORE_NOT_CONFIGURED', 'Loja Oficial nao configurada.');
  }
  const existingSnapshot = await adminDb.doc(`${SUBSCRIPTION_COLLECTION}/${ownerId}`).get();
  if (existingSnapshot.data()?.checkoutReservationStatus === 'pending') {
    throw new PlanManagementError(409, 'SUBSCRIPTION_RECONCILIATION_REQUIRED', 'Existe uma cobranca pendente de conciliacao. Conclua a verificacao antes de iniciar outra.');
  }
  const existing = parseStoredSubscription(ownerId, existingSnapshot.exists ? existingSnapshot.data() as Record<string, unknown> : undefined);
  if (existing && existing.providerStatus !== 'cancelled') {
    const provider = await mpRequest(`/preapproval/${encodeURIComponent(existing.providerSubscriptionId)}`) as MpPreapproval;
    await persistProviderState(ownerId, provider, existing);
    const refreshed = providerStatus(provider.status);
    if (refreshed !== 'cancelled') {
      throw new PlanManagementError(409, 'ACTIVE_SUBSCRIPTION_EXISTS', 'Esta loja já possui uma assinatura em andamento.');
    }
  }

  // Revalidate the persisted offer immediately before creating the provider charge.
  const latestOffer = await selectedPlan(targetPlan, officialProductId);
  if (Math.round(latestOffer.monthlyPriceBRL * 100) !== Math.round(plan.monthlyPriceBRL * 100)) {
    throw new PlanManagementError(409, 'OFFICIAL_PLAN_PRICE_CHANGED', 'O preco do plano foi alterado. Revise a oferta antes de contratar.');
  }
  const billingReference = randomUUID().replaceAll('-', '_');
  const reservationRef = adminDb.doc(`${SUBSCRIPTION_COLLECTION}/${ownerId}`);
  await adminDb.runTransaction(async transaction => {
    const snapshot = await transaction.get(reservationRef);
    const current = snapshot.data() ?? {};
    if (current.checkoutReservationStatus === 'pending' ||
        (current.providerSubscriptionId && current.providerStatus !== 'cancelled')) {
      throw new PlanManagementError(409, 'SUBSCRIPTION_CHECKOUT_IN_PROGRESS', 'Ja existe uma contratacao em andamento para esta loja.');
    }
    transaction.set(reservationRef, {
      checkoutReservationStatus: 'pending',
      billingReference,
      reservedPlan: targetPlan,
      reservedPlanVersion: plan.version,
      reservedAmountMinor: Math.round(plan.monthlyPriceBRL * 100),
      reservedCurrency: 'BRL',
      reservedPayerEmail: user.email,
      officialProductId,
      officialStoreId: official.canonicalStoreId,
      checkoutReservedAt: FieldValue.serverTimestamp(),
    }, { merge: true });
  });
  const provider = await mpRequest('/preapproval', {
    method: 'POST',
    headers: { 'X-Idempotency-Key': billingReference },
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
  await adminDb.runTransaction(async transaction => {
    const reservation = await transaction.get(reservationRef);
    const completion = decideReservationCompletion(billingReference, providerSubscriptionId, reservation.data() ?? {});
    if (completion === 'already-completed') return;
    if (completion === 'conflict') {
      throw new PlanManagementError(409, 'SUBSCRIPTION_RESERVATION_CONFLICT', 'A reserva desta contratacao foi alterada.');
    }
    transaction.set(reservationRef, {
    ...subscription,
    billingReference,
    checkoutReservationStatus: 'completed',
    officialProductId,
    officialStoreId: official.canonicalStoreId,
    payerEmail: user.email,
    providerPaymentStatus: 'pending_confirmation',
    providerPaymentStatusDetail: null,
    createdAt: FieldValue.serverTimestamp(),
    updatedAt: FieldValue.serverTimestamp(),
    });
  });
  // A webhook may have already confirmed payment while the checkout request
  // was finishing. Return the persisted state instead of a stale local copy.
  const completed = await reservationRef.get();
  const persisted = parseStoredSubscription(ownerId, completed.data() as Record<string, unknown>);
  if (completed.data()?.billingReference !== billingReference ||
      completed.data()?.checkoutReservationStatus !== 'completed' ||
      persisted?.providerSubscriptionId !== providerSubscriptionId) {
    throw new PlanManagementError(409, 'SUBSCRIPTION_RESERVATION_CONFLICT', 'A contratacao foi alterada antes da resposta do checkout.');
  }
  return { checkoutUrl: persisted.checkoutUrl || checkoutUrl, subscription: persisted };
};

export const reconcileOwnPaidPlanSubscription = async (authorization: string): Promise<KyrubPlanSubscriptionState> => {
  const user = await authenticateConsultantRequest(authorization);
  const ownerId = safeOwnerId(user.uid);
  const snapshot = await adminDb.doc(`${SUBSCRIPTION_COLLECTION}/${ownerId}`).get();
  const subscription = parseStoredSubscription(ownerId, snapshot.exists ? snapshot.data() as Record<string, unknown> : undefined);
  if (snapshot.data()?.checkoutReservationStatus === 'pending') {
    const reference = clean(snapshot.data()?.billingReference);
    if (!reference) {
      throw new PlanManagementError(409, 'SUBSCRIPTION_RESERVATION_INVALID', 'Reserva sem referencia de cobranca para conciliacao.');
    }
    const payerEmail = clean(snapshot.data()?.reservedPayerEmail);
    if (!payerEmail) {
      throw new PlanManagementError(409, 'SUBSCRIPTION_RESERVATION_INVALID', 'Reserva sem pagador para conciliacao.');
    }
    // Search by payer, then match the exact external reference locally.
    const search = await mpRequest(`/preapproval/search?payer_email=${encodeURIComponent(payerEmail)}&limit=100`);
    const paging = record(search.paging);
    if (Number(paging.total) > 100) {
      throw new PlanManagementError(409, 'SUBSCRIPTION_RECONCILIATION_PAGINATION', 'Pesquisa de assinaturas incompleta; conciliacao manual necessaria.');
    }
    const matches = (Array.isArray(search.results) ? search.results : [])
      .map(item => record(item))
      .filter(item => clean(item.external_reference) === reference);
    if (matches.length > 1) {
      throw new PlanManagementError(409, 'SUBSCRIPTION_RECONCILIATION_CONFLICT', 'Mais de uma assinatura encontrada para a mesma referencia.');
    }
    // Search responses may omit recurring terms. Validate those fields against
    // the full preapproval detail below, not the abbreviated search result.
    if (matches.length === 1 && !clean(matches[0].id)) {
      throw new PlanManagementError(409, 'SUBSCRIPTION_RECONCILIATION_INCOMPLETE', 'Assinatura encontrada sem identificador do provedor.');
    }
    if (matches.length === 1) {
      if (!Number.isSafeInteger(snapshot.data()?.reservedPlanVersion) || Number(snapshot.data()?.reservedPlanVersion) <= 0) {
        throw new PlanManagementError(409, 'SUBSCRIPTION_RESERVATION_INVALID', 'Reserva sem versao do plano para conciliacao.');
      }
      const candidate = matches[0];
      const provider = await mpRequest(`/preapproval/${encodeURIComponent(clean(candidate.id))}`) as MpPreapproval & Record<string, unknown>;
      const recurring = record(provider.auto_recurring);
      const amount = Number(recurring.transaction_amount);
      if (clean(provider.external_reference) !== reference ||
          clean(provider.payer_email).toLowerCase() !== payerEmail.toLowerCase() ||
          !Number.isFinite(amount) || Math.round(amount * 100) !== snapshot.data()?.reservedAmountMinor ||
          clean(recurring.currency_id) !== snapshot.data()?.reservedCurrency ||
          recurring.frequency !== 1 || recurring.frequency_type !== 'months') {
        throw new PlanManagementError(409, 'SUBSCRIPTION_RECONCILIATION_MISMATCH', 'Detalhes da assinatura divergem da reserva.');
      }
      const alreadyLinked = await adminDb.collection(SUBSCRIPTION_COLLECTION)
        .where('providerSubscriptionId', '==', clean(provider.id)).limit(2).get();
      if (alreadyLinked.docs.some(doc => doc.id !== ownerId)) {
        throw new PlanManagementError(409, 'SUBSCRIPTION_IDENTITY_CONFLICT', 'Assinatura ja vinculada a outra loja.');
      }
      const checkoutUrl = clean(provider.init_point);
      if (!checkoutUrl) throw new PlanManagementError(409, 'SUBSCRIPTION_RECONCILIATION_INCOMPLETE', 'Assinatura sem URL de checkout para recuperacao.');
      const now = new Date().toISOString();
      const recovered: KyrubPlanSubscriptionSnapshot = {
        schemaVersion: KYRUB_PLAN_BILLING_SCHEMA_VERSION,
        storeId: ownerId, ownerId,
        plan: paidPlan(snapshot.data()?.reservedPlan),
        planVersion: snapshot.data()?.reservedPlanVersion as number,
        provider: PROVIDER,
        providerSubscriptionId: clean(provider.id),
        providerStatus: providerStatus(provider.status),
        amountMinor: snapshot.data()?.reservedAmountMinor as number,
        currency: 'BRL', checkoutUrl, createdAt: now, updatedAt: now,
        activatedAt: null, cancelledAt: null,
      };
      await adminDb.runTransaction(async transaction => {
        const latest = await transaction.get(snapshot.ref);
        if (latest.data()?.billingReference !== reference || latest.data()?.checkoutReservationStatus !== 'pending') {
          throw new PlanManagementError(409, 'SUBSCRIPTION_RESERVATION_CONFLICT', 'A reserva foi alterada durante a conciliacao.');
        }
        transaction.set(snapshot.ref, {
          ...recovered, billingReference: reference,
          checkoutReservationStatus: 'completed',
          officialProductId: latest.data()?.officialProductId,
          officialStoreId: latest.data()?.officialStoreId,
          payerEmail,
          providerPaymentStatus: 'pending_confirmation',
          updatedAt: FieldValue.serverTimestamp(),
        }, { merge: true });
      });
      await persistProviderState(ownerId, provider, recovered);
      return loadOwnPlanSubscriptionState(authorization);
    }
    // A missing result is not proof of absence: keep the reservation locked.
    throw new PlanManagementError(409, 'SUBSCRIPTION_RECONCILIATION_REQUIRED', 'A contratacao aguarda conciliacao com o Mercado Pago. Nenhuma nova cobranca deve ser iniciada.');
  }
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
  eventType?: string;
}): Promise<{ accepted: true }> => {
  if (!verifyPaidPlanWebhookSignature(input)) {
    throw new PlanManagementError(401, 'INVALID_BILLING_WEBHOOK_SIGNATURE', 'Assinatura do webhook inválida.');
  }
  let providerSubscriptionId = clean(input.dataId);
  if (clean(input.eventType) === 'subscription_authorized_payment') {
    const invoice = await mpRequest(`/authorized_payments/${encodeURIComponent(input.dataId)}`);
    providerSubscriptionId = scalar(invoice.preapproval_id);
    if (!providerSubscriptionId) return { accepted: true };
  }
  const matches = await adminDb.collection(SUBSCRIPTION_COLLECTION)
    .where('providerSubscriptionId', '==', providerSubscriptionId)
    .limit(2)
    .get();
  if (matches.size > 1) {
    throw new PlanManagementError(409, 'SUBSCRIPTION_IDENTITY_CONFLICT', 'A assinatura do provedor está vinculada a mais de uma loja.');
  }
  if (matches.empty) {
    // A signed webhook may arrive after Mercado Pago creates the preapproval
    // but before our checkout request writes the provider ID.
    const provider = await mpRequest(`/preapproval/${encodeURIComponent(providerSubscriptionId)}`) as MpPreapproval & Record<string, unknown>;
    const reference = clean(provider.external_reference);
    if (!reference || clean(provider.id) !== providerSubscriptionId) return { accepted: true };
    const reservations = await adminDb.collection(SUBSCRIPTION_COLLECTION)
      .where('billingReference', '==', reference).limit(2).get();
    if (reservations.size > 1) {
      throw new PlanManagementError(409, 'SUBSCRIPTION_IDENTITY_CONFLICT', 'Referencia de cobranca vinculada a mais de uma loja.');
    }
    if (reservations.empty) return { accepted: true };
    const reservation = reservations.docs[0];
    const data = reservation.data();
    if (data.checkoutReservationStatus !== 'pending') return { accepted: true };
    const recurring = record(provider.auto_recurring);
    const amount = Number(recurring.transaction_amount);
    if (clean(provider.payer_email).toLowerCase() !== clean(data.reservedPayerEmail).toLowerCase() ||
        !Number.isFinite(amount) || Math.round(amount * 100) !== data.reservedAmountMinor ||
        clean(recurring.currency_id) !== data.reservedCurrency ||
        recurring.frequency !== 1 || recurring.frequency_type !== 'months' ||
        !Number.isSafeInteger(data.reservedPlanVersion) || data.reservedPlanVersion <= 0) {
      throw new PlanManagementError(409, 'SUBSCRIPTION_RECONCILIATION_MISMATCH', 'Notificacao de assinatura diverge da reserva.');
    }
    const checkoutUrl = clean(provider.init_point);
    if (!checkoutUrl) {
      throw new PlanManagementError(409, 'SUBSCRIPTION_RECONCILIATION_INCOMPLETE', 'Assinatura sem URL de checkout.');
    }
    const ownerId = reservation.id;
    // Do not recover a provider preapproval already owned by another store.
    // This mirrors the authenticated reconciliation identity check.
    const linked = await adminDb.collection(SUBSCRIPTION_COLLECTION)
      .where('providerSubscriptionId', '==', providerSubscriptionId).limit(2).get();
    if (linked.docs.some(doc => doc.id !== ownerId)) {
      throw new PlanManagementError(409, 'SUBSCRIPTION_IDENTITY_CONFLICT', 'Assinatura ja vinculada a outra loja.');
    }
    const now = new Date().toISOString();
    const recovered: KyrubPlanSubscriptionSnapshot = {
      schemaVersion: KYRUB_PLAN_BILLING_SCHEMA_VERSION,
      storeId: ownerId, ownerId, plan: paidPlan(data.reservedPlan),
      planVersion: data.reservedPlanVersion as number,
      provider: PROVIDER, providerSubscriptionId,
      providerStatus: providerStatus(provider.status),
      amountMinor: data.reservedAmountMinor as number,
      currency: 'BRL', checkoutUrl, createdAt: now, updatedAt: now,
      activatedAt: null, cancelledAt: null,
    };
    await adminDb.runTransaction(async transaction => {
      const latest = await transaction.get(reservation.ref);
      const completion = decideReservationCompletion(reference, providerSubscriptionId, latest.data() ?? {});
      if (completion === 'already-completed') return;
      if (completion === 'conflict') {
        throw new PlanManagementError(409, 'SUBSCRIPTION_RESERVATION_CONFLICT', 'Reserva alterada durante recuperacao do webhook.');
      }
      transaction.set(reservation.ref, {
        ...recovered, billingReference: reference,
        checkoutReservationStatus: 'completed',
        officialProductId: latest.data()?.officialProductId,
        officialStoreId: latest.data()?.officialStoreId,
        payerEmail: clean(data.reservedPayerEmail),
        providerPaymentStatus: 'pending_confirmation',
        updatedAt: FieldValue.serverTimestamp(),
      }, { merge: true });
    });
    await persistProviderState(ownerId, provider, recovered);
    return { accepted: true };
  }
  const ownerId = matches.docs[0].id;
  const subscription = parseStoredSubscription(ownerId, matches.docs[0].data() as Record<string, unknown>);
  if (!subscription) return { accepted: true };
  const provider = await mpRequest(`/preapproval/${encodeURIComponent(providerSubscriptionId)}`) as MpPreapproval;
  await persistProviderState(ownerId, provider, subscription);
  return { accepted: true };
};
