import { randomUUID } from 'node:crypto';
import { FieldValue, Timestamp } from 'firebase-admin/firestore';
import type { KyrubCommercialPlanId } from '../../shared/kyrubCommercialPlans.js';
import {
  isKyrubPaidPlanId,
  type KyrubPaidPlanId,
  type KyrubPlanSubscriptionCheckoutResult,
  type KyrubPlanSubscriptionPublicSnapshot,
  type KyrubPlanSubscriptionStatus,
} from '../../shared/kyrubPlanSubscriptions.js';
import { authenticateConsultantRequest } from '../ai/consultantAuth.js';
import { adminDb } from '../firebaseAdmin.js';
import {
  cancelMercadoPagoSubscription,
  createMercadoPagoSubscriptionCheckout,
  getMercadoPagoSubscription,
  isMercadoPagoSubscriptionRuntimeConfigured,
  type MercadoPagoSubscription,
} from '../payments/mercadoPagoSubscriptionProvider.js';
import { loadPublicActivePlanCatalog } from './publicPlanCatalogService.js';
import { PlanManagementError } from './planManagementService.js';

const ROOT = 'kyrub_admin/control_plane';
const SUBSCRIPTION_COLLECTION = `${ROOT}/store_subscriptions`;
const ENTITLEMENT_COLLECTION = `${ROOT}/store_entitlements`;
const AUDIT_COLLECTION = `${ROOT}/audit_logs`;
const CREATING_LEASE_MS = 2 * 60 * 1000;

const clean = (value: unknown): string =>
  typeof value === 'string' ? value.trim() : String(value ?? '').trim();

const record = (value: unknown): Record<string, unknown> =>
  value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};

const numberValue = (value: unknown): number | null => {
  const parsed = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(parsed) ? parsed : null;
};

const integerValue = (value: unknown): number | null => {
  const parsed = numberValue(value);
  return parsed !== null && Number.isInteger(parsed) ? parsed : null;
};

const iso = (value: unknown): string | null => {
  if (!value) return null;
  if (value instanceof Timestamp) return value.toDate().toISOString();
  if (typeof value === 'string') {
    const parsed = new Date(value);
    return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString();
  }
  if (typeof value === 'object' && 'toDate' in value) {
    try {
      return (value as { toDate(): Date }).toDate().toISOString();
    } catch {
      return null;
    }
  }
  return null;
};

const safeUid = (value: unknown): string => {
  const uid = clean(value);
  if (!/^[a-zA-Z0-9_-]{1,128}$/.test(uid)) {
    throw new PlanManagementError(400, 'INVALID_STORE_ID', 'A identidade da Loja Kyrub é inválida.');
  }
  return uid;
};

const normalizeCurrentPlan = (value: unknown): KyrubCommercialPlanId =>
  value === 'business' || value === 'pro' ? value : 'free';

const normalizeProviderStatus = (value: unknown): KyrubPlanSubscriptionStatus => {
  const status = clean(value).toLowerCase();
  if (status === 'authorized') return 'active';
  if (status === 'paused') return 'paused';
  if (status === 'canceled' || status === 'cancelled') return 'canceled';
  return 'pending';
};

const findCanonicalStore = async (ownerId: string): Promise<string | null> => {
  const snapshot = await adminDb.collection('stores').where('ownerId', '==', ownerId).get();
  if (snapshot.size > 1) {
    throw new PlanManagementError(
      409,
      'STORE_IDENTITY_CONFLICT',
      'Mais de uma loja canônica foi encontrada para este proprietário.'
    );
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
  transaction.set(
    adminDb.doc(`users/${ownerId}/stores/${ownerId}`),
    { plan, updatedAt: now },
    { merge: true }
  );
  transaction.set(
    adminDb.doc(`tenants/${ownerId}`),
    { id: ownerId, ownerId, plan, updatedAt: now },
    { merge: true }
  );
  if (canonicalStoreId) {
    transaction.set(
      adminDb.doc(`stores/${canonicalStoreId}`),
      { plan, legacyTenantId: ownerId, updatedAt: now },
      { merge: true }
    );
  }
};

const publicSubscription = (
  data: Record<string, unknown>
): KyrubPlanSubscriptionPublicSnapshot => ({
  schemaVersion: 1,
  storeId: clean(data.storeId),
  plan: data.plan === 'business' ? 'business' : 'pro',
  planVersion: integerValue(data.planVersion) ?? 1,
  monthlyPriceBRL: numberValue(data.monthlyPriceBRL) ?? 0,
  currency: 'BRL',
  provider: 'mercado-pago',
  status:
    data.status === 'creating' ||
    data.status === 'active' ||
    data.status === 'paused' ||
    data.status === 'canceled' ||
    data.status === 'error'
      ? data.status
      : 'pending',
  providerStatus: clean(data.providerStatus),
  checkoutUrl: clean(data.checkoutUrl),
  nextPaymentAt: iso(data.nextPaymentAt),
  createdAt: iso(data.createdAt),
  updatedAt: iso(data.updatedAt),
  canceledAt: iso(data.canceledAt),
});

const activeTemporaryEntitlement = (data: Record<string, unknown>): boolean => {
  if (data.status !== 'active') return false;
  if (data.source !== 'promotion' && data.source !== 'admin_grant') return false;
  const benefitEndsAt = iso(data.benefitEndsAt);
  return benefitEndsAt === null || new Date(benefitEndsAt).getTime() > Date.now();
};

const subscriptionReturnUrl = (): string => {
  const configured = clean(process.env.KYRUB_PLAN_RETURN_URL);
  const candidate = configured || 'https://planos.kyrub.com/?subscription=return';
  try {
    const url = new URL(candidate);
    if (url.protocol !== 'https:') throw new Error('HTTPS_REQUIRED');
    return url.toString();
  } catch {
    throw new PlanManagementError(
      503,
      'PLAN_RETURN_URL_INVALID',
      'A URL de retorno da contratação de planos não está configurada corretamente.'
    );
  }
};

const externalReference = (
  ownerId: string,
  plan: KyrubPaidPlanId,
  planVersion: number,
  attemptId: string
): string => `kps1:${ownerId}:${plan}:${planVersion}:${attemptId}`;

const parseExternalReference = (value: unknown): {
  ownerId: string;
  plan: KyrubPaidPlanId;
  planVersion: number;
  attemptId: string;
} => {
  const match = /^kps1:([a-zA-Z0-9_-]{1,128}):(pro|business):(\d{1,9}):([a-zA-Z0-9-]{8,80})$/.exec(clean(value));
  if (!match) {
    throw new PlanManagementError(
      409,
      'SUBSCRIPTION_REFERENCE_INVALID',
      'A assinatura recebida não pertence a um contrato Kyrub reconhecido.'
    );
  }
  return {
    ownerId: safeUid(match[1]),
    plan: match[2] as KyrubPaidPlanId,
    planVersion: Number(match[3]),
    attemptId: match[4],
  };
};

export type OwnPlanSubscriptionStatusResult = {
  billingAvailable: boolean;
  subscription: KyrubPlanSubscriptionPublicSnapshot | null;
};

export const loadOwnPlanSubscription = async (
  authorization: string
): Promise<OwnPlanSubscriptionStatusResult> => {
  const user = await authenticateConsultantRequest(authorization);
  const ownerId = safeUid(user.uid);
  const [configured, snapshot] = await Promise.all([
    isMercadoPagoSubscriptionRuntimeConfigured(),
    adminDb.doc(`${SUBSCRIPTION_COLLECTION}/${ownerId}`).get(),
  ]);
  return {
    billingAvailable: configured,
    subscription: snapshot.exists
      ? publicSubscription(snapshot.data() as Record<string, unknown>)
      : null,
  };
};

export const createOwnPlanSubscriptionCheckout = async (
  authorization: string,
  rawPlan: unknown
): Promise<KyrubPlanSubscriptionCheckoutResult> => {
  const user = await authenticateConsultantRequest(authorization);
  const ownerId = safeUid(user.uid);
  if (!isKyrubPaidPlanId(rawPlan)) {
    throw new PlanManagementError(400, 'INVALID_TARGET_PLAN', 'Escolha Pro ou Business.');
  }
  const payerEmail = clean(user.email).toLocaleLowerCase('pt-BR');
  if (!payerEmail || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/u.test(payerEmail)) {
    throw new PlanManagementError(
      409,
      'SUBSCRIPTION_EMAIL_REQUIRED',
      'Sua conta Kyrub precisa ter um e-mail válido antes da contratação.'
    );
  }
  if (!(await isMercadoPagoSubscriptionRuntimeConfigured())) {
    throw new PlanManagementError(
      503,
      'PLAN_BILLING_NOT_CONFIGURED',
      'A cobrança recorrente de planos ainda não está configurada neste ambiente.'
    );
  }

  const catalog = await loadPublicActivePlanCatalog();
  const plan = catalog.plans.find(entry => entry.planId === rawPlan);
  if (!plan || plan.monthlyPriceBRL <= 0) {
    throw new PlanManagementError(409, 'PLAN_NOT_BILLABLE', 'O plano escolhido não possui uma cobrança mensal ativa.');
  }
  const canonicalStoreId = await findCanonicalStore(ownerId);
  const storeReference = adminDb.doc(`users/${ownerId}/stores/${ownerId}`);
  const subscriptionReference = adminDb.doc(`${SUBSCRIPTION_COLLECTION}/${ownerId}`);
  const entitlementReference = adminDb.doc(`${ENTITLEMENT_COLLECTION}/${ownerId}`);
  const attemptId = randomUUID();
  const providerReference = externalReference(ownerId, rawPlan, plan.version, attemptId);
  let reusable: KyrubPlanSubscriptionPublicSnapshot | null = null;

  await adminDb.runTransaction(async transaction => {
    const [storeSnapshot, subscriptionSnapshot, entitlementSnapshot] = await Promise.all([
      transaction.get(storeReference),
      transaction.get(subscriptionReference),
      transaction.get(entitlementReference),
    ]);
    if (!storeSnapshot.exists) {
      throw new PlanManagementError(404, 'STORE_NOT_FOUND', 'Ative sua Loja Kyrub antes de contratar um plano.');
    }
    const storeData = storeSnapshot.data() as Record<string, unknown>;
    if (clean(storeData.id) !== ownerId || clean(storeData.ownerId) !== ownerId) {
      throw new PlanManagementError(409, 'STORE_OWNERSHIP_CONFLICT', 'A identidade da loja não corresponde à sua conta.');
    }

    const existing = subscriptionSnapshot.exists
      ? subscriptionSnapshot.data() as Record<string, unknown>
      : null;
    if (existing?.status === 'active') {
      throw new PlanManagementError(409, 'SUBSCRIPTION_ALREADY_ACTIVE', 'Sua loja já possui uma assinatura paga ativa.');
    }
    if (
      existing?.status === 'pending' &&
      existing.plan === rawPlan &&
      clean(existing.checkoutUrl) &&
      clean(existing.providerSubscriptionId)
    ) {
      reusable = publicSubscription(existing);
      return;
    }
    if (existing?.status === 'creating') {
      const updatedAt = iso(existing.updatedAt);
      if (updatedAt && Date.now() - new Date(updatedAt).getTime() < CREATING_LEASE_MS) {
        throw new PlanManagementError(
          409,
          'SUBSCRIPTION_CHECKOUT_IN_PROGRESS',
          'Já existe uma contratação sendo preparada para esta loja.'
        );
      }
    }
    if (
      entitlementSnapshot.exists &&
      activeTemporaryEntitlement(entitlementSnapshot.data() as Record<string, unknown>)
    ) {
      throw new PlanManagementError(
        409,
        'TEMPORARY_PLAN_BENEFIT_ACTIVE',
        'Sua loja possui um benefício promocional ou cortesia ativo. A assinatura paga não será sobreposta enquanto esse benefício estiver vigente.'
      );
    }

    const now = FieldValue.serverTimestamp();
    transaction.set(subscriptionReference, {
      schemaVersion: 1,
      storeId: ownerId,
      ownerId,
      plan: rawPlan,
      planVersion: plan.version,
      monthlyPriceBRL: Number(plan.monthlyPriceBRL.toFixed(2)),
      currency: 'BRL',
      provider: 'mercado-pago',
      status: 'creating',
      providerStatus: '',
      providerSubscriptionId: '',
      checkoutUrl: '',
      nextPaymentAt: null,
      payerEmail,
      externalReference: providerReference,
      checkoutAttemptId: attemptId,
      previousPlan: normalizeCurrentPlan(storeData.plan),
      lastError: null,
      createdAt: existing?.createdAt ?? now,
      updatedAt: now,
      canceledAt: null,
    });
  });

  if (reusable) {
    return {
      status: reusable.status,
      subscription: reusable,
      checkoutUrl: reusable.checkoutUrl,
    };
  }

  try {
    const provider = await createMercadoPagoSubscriptionCheckout({
      planLabel: rawPlan === 'business' ? 'Business' : 'Pro',
      payerEmail,
      amountBRL: plan.monthlyPriceBRL,
      externalReference: providerReference,
      backUrl: subscriptionReturnUrl(),
    });
    const providerSubscriptionId = clean(provider.id);
    const checkoutUrl = clean(provider.init_point);
    if (!providerSubscriptionId || !/^https:\/\//i.test(checkoutUrl)) {
      throw new Error('MERCADO_PAGO_SUBSCRIPTION_CHECKOUT_INVALID');
    }

    const providerStatus = clean(provider.status) || 'pending';
    const normalizedStatus = normalizeProviderStatus(providerStatus);
    const now = FieldValue.serverTimestamp();
    await adminDb.runTransaction(async transaction => {
      const current = await transaction.get(subscriptionReference);
      if (!current.exists || clean(current.data()?.checkoutAttemptId) !== attemptId) {
        throw new PlanManagementError(
          409,
          'SUBSCRIPTION_CHECKOUT_SUPERSEDED',
          'Esta tentativa de contratação foi substituída por uma solicitação mais recente.'
        );
      }
      transaction.update(subscriptionReference, {
        status: normalizedStatus,
        providerStatus,
        providerSubscriptionId,
        checkoutUrl,
        nextPaymentAt: clean(provider.next_payment_date) || null,
        lastProviderSyncAt: now,
        lastError: null,
        updatedAt: now,
      });
    });

    const saved = await subscriptionReference.get();
    const subscription = publicSubscription(saved.data() as Record<string, unknown>);
    return { status: subscription.status, subscription, checkoutUrl };
  } catch (error) {
    const message = error instanceof Error ? error.message : 'unknown';
    await subscriptionReference.set({
      status: 'error',
      lastError: message.slice(0, 240),
      updatedAt: FieldValue.serverTimestamp(),
    }, { merge: true }).catch(() => undefined);
    if (error instanceof PlanManagementError) throw error;
    throw new PlanManagementError(
      502,
      'SUBSCRIPTION_PROVIDER_ERROR',
      'O Mercado Pago não conseguiu iniciar a assinatura agora. Nenhum plano pago foi ativado.'
    );
  }
};

export const synchronizeMercadoPagoPlanSubscription = async (
  provider: MercadoPagoSubscription
): Promise<KyrubPlanSubscriptionPublicSnapshot> => {
  const reference = parseExternalReference(provider.external_reference);
  const ownerId = reference.ownerId;
  const providerSubscriptionId = clean(provider.id);
  if (!providerSubscriptionId) {
    throw new PlanManagementError(409, 'SUBSCRIPTION_PROVIDER_ID_MISSING', 'A assinatura recebida não possui identificador do provedor.');
  }
  const canonicalStoreId = await findCanonicalStore(ownerId);
  const subscriptionReference = adminDb.doc(`${SUBSCRIPTION_COLLECTION}/${ownerId}`);
  const entitlementReference = adminDb.doc(`${ENTITLEMENT_COLLECTION}/${ownerId}`);
  const storeReference = adminDb.doc(`users/${ownerId}/stores/${ownerId}`);
  const normalizedStatus = normalizeProviderStatus(provider.status);
  const providerStatus = clean(provider.status);
  const providerAmount = numberValue(provider.auto_recurring?.transaction_amount);
  const providerCurrency = clean(provider.auto_recurring?.currency_id).toUpperCase();

  await adminDb.runTransaction(async transaction => {
    const [subscriptionSnapshot, storeSnapshot, entitlementSnapshot] = await Promise.all([
      transaction.get(subscriptionReference),
      transaction.get(storeReference),
      transaction.get(entitlementReference),
    ]);
    if (!subscriptionSnapshot.exists || !storeSnapshot.exists) {
      throw new PlanManagementError(404, 'SUBSCRIPTION_NOT_FOUND', 'A assinatura não corresponde a uma Loja Kyrub ativa.');
    }
    const data = subscriptionSnapshot.data() as Record<string, unknown>;
    if (
      data.plan !== reference.plan ||
      integerValue(data.planVersion) !== reference.planVersion ||
      clean(data.externalReference) !== clean(provider.external_reference) ||
      (clean(data.providerSubscriptionId) && clean(data.providerSubscriptionId) !== providerSubscriptionId)
    ) {
      throw new PlanManagementError(409, 'SUBSCRIPTION_AUTHORITY_MISMATCH', 'Os dados da assinatura divergem do contrato canônico do Kyrub.');
    }
    const contractAmount = numberValue(data.monthlyPriceBRL);
    if (
      providerAmount === null ||
      contractAmount === null ||
      Math.abs(providerAmount - contractAmount) > 0.009 ||
      providerCurrency !== 'BRL'
    ) {
      throw new PlanManagementError(409, 'SUBSCRIPTION_AMOUNT_MISMATCH', 'Valor ou moeda da assinatura divergem do plano contratado no Kyrub.');
    }

    const previousStatus = clean(data.status);
    const now = FieldValue.serverTimestamp();
    transaction.set(subscriptionReference, {
      status: normalizedStatus,
      providerStatus,
      providerSubscriptionId,
      checkoutUrl: clean(provider.init_point) || clean(data.checkoutUrl),
      nextPaymentAt: clean(provider.next_payment_date) || null,
      lastProviderSyncAt: now,
      lastError: null,
      updatedAt: now,
      ...(normalizedStatus === 'canceled' ? { canceledAt: now } : {}),
    }, { merge: true });

    if (normalizedStatus === 'active') {
      writePlanMirrors(transaction, ownerId, canonicalStoreId, reference.plan, now);
      transaction.set(entitlementReference, {
        schemaVersion: 2,
        storeId: ownerId,
        ownerId,
        plan: reference.plan,
        planVersion: reference.planVersion,
        source: 'subscription',
        status: 'active',
        campaignId: null,
        couponCode: null,
        discountType: null,
        discountValue: null,
        benefitStartsAt: entitlementSnapshot.exists && entitlementSnapshot.data()?.source === 'subscription'
          ? entitlementSnapshot.data()?.benefitStartsAt ?? now
          : now,
        benefitEndsAt: null,
        grantedBy: null,
        updatedAt: now,
      });
    } else if (normalizedStatus === 'paused' || normalizedStatus === 'canceled') {
      const entitlement = entitlementSnapshot.exists
        ? entitlementSnapshot.data() as Record<string, unknown>
        : null;
      if (entitlement?.source === 'subscription' && entitlement.status === 'active') {
        writePlanMirrors(transaction, ownerId, canonicalStoreId, 'free', now);
        transaction.set(entitlementReference, {
          ...entitlement,
          plan: 'free',
          status: 'revoked',
          benefitEndsAt: now,
          updatedAt: now,
        });
      }
    }

    if (previousStatus !== normalizedStatus) {
      const auditReference = adminDb.doc(`${AUDIT_COLLECTION}/${randomUUID().replaceAll('-', '_')}`);
      transaction.set(auditReference, {
        id: auditReference.id,
        action: 'store.subscription.status_changed',
        actorId: 'mercado-pago',
        actorRole: 'payment_provider',
        targetType: 'store',
        targetId: ownerId,
        previousStatus,
        nextStatus: normalizedStatus,
        plan: reference.plan,
        planVersion: reference.planVersion,
        providerSubscriptionId,
        source: 'server',
        createdAt: now,
      });
    }
  });

  const saved = await subscriptionReference.get();
  return publicSubscription(saved.data() as Record<string, unknown>);
};

export const refreshOwnPlanSubscription = async (
  authorization: string
): Promise<OwnPlanSubscriptionStatusResult> => {
  const user = await authenticateConsultantRequest(authorization);
  const ownerId = safeUid(user.uid);
  const reference = adminDb.doc(`${SUBSCRIPTION_COLLECTION}/${ownerId}`);
  const snapshot = await reference.get();
  if (!snapshot.exists) {
    return {
      billingAvailable: await isMercadoPagoSubscriptionRuntimeConfigured(),
      subscription: null,
    };
  }
  const providerSubscriptionId = clean(snapshot.data()?.providerSubscriptionId);
  if (!providerSubscriptionId) {
    return {
      billingAvailable: await isMercadoPagoSubscriptionRuntimeConfigured(),
      subscription: publicSubscription(snapshot.data() as Record<string, unknown>),
    };
  }
  const provider = await getMercadoPagoSubscription(providerSubscriptionId);
  const subscription = await synchronizeMercadoPagoPlanSubscription(provider);
  return { billingAvailable: true, subscription };
};

export const cancelOwnPlanSubscription = async (
  authorization: string
): Promise<OwnPlanSubscriptionStatusResult> => {
  const user = await authenticateConsultantRequest(authorization);
  const ownerId = safeUid(user.uid);
  const snapshot = await adminDb.doc(`${SUBSCRIPTION_COLLECTION}/${ownerId}`).get();
  if (!snapshot.exists) {
    throw new PlanManagementError(404, 'SUBSCRIPTION_NOT_FOUND', 'Sua loja não possui assinatura paga para cancelar.');
  }
  const data = snapshot.data() as Record<string, unknown>;
  if (data.status === 'canceled') {
    return { billingAvailable: true, subscription: publicSubscription(data) };
  }
  const providerSubscriptionId = clean(data.providerSubscriptionId);
  if (!providerSubscriptionId) {
    throw new PlanManagementError(409, 'SUBSCRIPTION_PROVIDER_ID_MISSING', 'A assinatura ainda não possui vínculo confirmado com o provedor.');
  }
  const provider = await cancelMercadoPagoSubscription(providerSubscriptionId);
  const subscription = await synchronizeMercadoPagoPlanSubscription(provider);
  return { billingAvailable: true, subscription };
};

export const synchronizeMercadoPagoPlanSubscriptionById = async (
  providerSubscriptionId: string
): Promise<KyrubPlanSubscriptionPublicSnapshot> => {
  const id = clean(providerSubscriptionId);
  if (!id) {
    throw new PlanManagementError(400, 'SUBSCRIPTION_PROVIDER_ID_REQUIRED', 'Identificador da assinatura não informado.');
  }
  return synchronizeMercadoPagoPlanSubscription(
    await getMercadoPagoSubscription(id)
  );
};
