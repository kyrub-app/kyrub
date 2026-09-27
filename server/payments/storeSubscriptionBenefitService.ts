import { createHash } from 'node:crypto';
import { adminDb } from '../firebaseAdmin.js';
import { authenticateConsultantRequest } from '../ai/consultantAuth.js';
import {
  parseProductSaleModality,
  type ProductSubscriptionTerms,
} from '../../shared/productSaleModality.js';
import {
  STORE_SUBSCRIPTION_BENEFIT_SCHEMA_VERSION,
  type ConsumeStoreSubscriptionBenefitResult,
  type StoreSubscriptionBenefitCycle,
  type StoreSubscriptionBenefitUsage,
} from '../../shared/storeSubscriptionBenefits.js';

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
const positiveInteger = (value: unknown): number | null => {
  const number = Number(value);
  return Number.isInteger(number) && number > 0 ? number : null;
};
const hash = (value: string): string => createHash('sha256').update(value).digest('hex');
const nowIso = (): string => new Date().toISOString();

export class StoreSubscriptionBenefitError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: string,
    message: string
  ) {
    super(message);
    this.name = 'StoreSubscriptionBenefitError';
  }
}

const fail = (status: number, code: string, message: string): never => {
  throw new StoreSubscriptionBenefitError(status, code, message);
};

interface CanonicalStoreIdentity {
  canonicalStoreId: string;
  ownerUserId: string;
  legacyStoreId: string;
}

interface BenefitSourceSubscription {
  id: string;
  storeId: string;
  ownerUserId: string;
  buyerId: string;
  productId: string;
  productName: string;
  state: string;
  providerInvoiceId: string;
  providerPaymentId: string;
  providerPaymentStatus: string;
  providerPaymentStatusDetail: string;
  paymentConfirmedAt: string;
  terms: ProductSubscriptionTerms;
}

const resolveCanonicalStore = async (
  storeReference: unknown
): Promise<CanonicalStoreIdentity> => {
  const input = safeIdentity(storeReference);
  if (!input) {
    fail(400, 'SUBSCRIPTION_BENEFIT_STORE_REQUIRED', 'A loja não foi identificada.');
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
      fail(404, 'SUBSCRIPTION_BENEFIT_STORE_NOT_FOUND', 'A loja não foi encontrada.');
    }
    if (matches.size !== 1) {
      fail(409, 'SUBSCRIPTION_BENEFIT_STORE_AMBIGUOUS', 'A identidade da loja está ambígua.');
    }
    canonical = matches.docs[0];
  }
  const data = record(canonical.data());
  const canonicalStoreId = safeIdentity(canonical.id);
  const ownerUserId = safeIdentity(data.ownerId);
  const legacyStoreId = safeIdentity(data.legacyTenantId) || ownerUserId;
  if (!canonicalStoreId || !ownerUserId || !legacyStoreId) {
    fail(409, 'SUBSCRIPTION_BENEFIT_STORE_IDENTITY_INVALID', 'A identidade da loja está inconsistente.');
  }
  return { canonicalStoreId, ownerUserId, legacyStoreId };
};

const loadBenefitSourceSubscription = async (
  storeId: string,
  subscriptionIdInput: unknown
): Promise<BenefitSourceSubscription> => {
  const subscriptionId = safeIdentity(subscriptionIdInput);
  if (!subscriptionId) {
    fail(400, 'SUBSCRIPTION_BENEFIT_SUBSCRIPTION_REQUIRED', 'A assinatura não foi identificada.');
  }
  const snapshot = await adminDb.doc(`stores/${storeId}/subscriptions/${subscriptionId}`).get();
  if (!snapshot.exists) {
    fail(404, 'SUBSCRIPTION_BENEFIT_SUBSCRIPTION_NOT_FOUND', 'A assinatura não foi encontrada.');
  }
  const data = record(snapshot.data());
  const modality = parseProductSaleModality(data.saleModality);
  if (!modality || modality.mode !== 'subscription' || !modality.subscription) {
    fail(409, 'SUBSCRIPTION_BENEFIT_TERMS_INVALID', 'A assinatura não possui termos de benefício válidos.');
  }
  const source: BenefitSourceSubscription = {
    id: subscriptionId,
    storeId,
    ownerUserId: safeIdentity(data.ownerUserId),
    buyerId: safeIdentity(data.buyerId),
    productId: safeIdentity(data.productId),
    productName: clean(data.productName),
    state: clean(data.state),
    providerInvoiceId: safeIdentity(data.providerInvoiceId),
    providerPaymentId: safeIdentity(data.providerPaymentId),
    providerPaymentStatus: clean(data.providerPaymentStatus),
    providerPaymentStatusDetail: clean(data.providerPaymentStatusDetail),
    paymentConfirmedAt: clean(data.paymentConfirmedAt),
    terms: modality.subscription,
  };
  if (
    source.ownerUserId.length === 0 ||
    source.buyerId.length === 0 ||
    source.productId.length === 0 ||
    source.productName.length === 0
  ) {
    fail(409, 'SUBSCRIPTION_BENEFIT_SOURCE_INVALID', 'A assinatura não possui identidade comercial suficiente.');
  }
  return source;
};

const daysInUtcMonth = (year: number, month: number): number =>
  new Date(Date.UTC(year, month + 1, 0)).getUTCDate();

const billingPeriodEndsAt = (
  paidAt: string,
  terms: ProductSubscriptionTerms
): string => {
  const start = new Date(paidAt);
  if (!Number.isFinite(start.getTime())) {
    fail(409, 'SUBSCRIPTION_BENEFIT_PAID_AT_INVALID', 'O ciclo pago não possui uma data válida.');
  }
  const count = terms.billingInterval.count;
  if (terms.billingInterval.unit === 'day' || terms.billingInterval.unit === 'week') {
    const days = terms.billingInterval.unit === 'week' ? count * 7 : count;
    return new Date(start.getTime() + days * 24 * 60 * 60 * 1000).toISOString();
  }

  const months = terms.billingInterval.unit === 'year' ? count * 12 : count;
  const end = new Date(start.getTime());
  const targetMonthIndex = end.getUTCMonth() + months;
  const targetYear = end.getUTCFullYear() + Math.floor(targetMonthIndex / 12);
  const targetMonth = ((targetMonthIndex % 12) + 12) % 12;
  const targetDay = Math.min(end.getUTCDate(), daysInUtcMonth(targetYear, targetMonth));
  end.setUTCDate(1);
  end.setUTCFullYear(targetYear);
  end.setUTCMonth(targetMonth);
  end.setUTCDate(targetDay);
  return end.toISOString();
};

const cycleIdForInvoice = (invoiceId: string): string => `cycle_${hash(invoiceId).slice(0, 40)}`;
const cyclePath = (storeId: string, subscriptionId: string, cycleId: string): string =>
  `stores/${storeId}/subscriptions/${subscriptionId}/benefitCycles/${cycleId}`;
const usagePath = (
  storeId: string,
  subscriptionId: string,
  cycleId: string,
  usageId: string
): string => `${cyclePath(storeId, subscriptionId, cycleId)}/usages/${usageId}`;

const parseCycle = (value: unknown): StoreSubscriptionBenefitCycle | null => {
  const data = record(value);
  const grantedUnits = data.grantedUnits === null ? null : positiveInteger(data.grantedUnits);
  const consumedUnits = Number(data.consumedUnits);
  const remainingUnits = data.remainingUnits === null ? null : Number(data.remainingUnits);
  if (
    data.schemaVersion !== STORE_SUBSCRIPTION_BENEFIT_SCHEMA_VERSION ||
    !safeIdentity(data.id) ||
    !safeIdentity(data.storeId) ||
    !safeIdentity(data.subscriptionId) ||
    !safeIdentity(data.buyerId) ||
    !safeIdentity(data.productId) ||
    !safeIdentity(data.providerInvoiceId) ||
    !safeIdentity(data.providerPaymentId) ||
    !Number.isInteger(consumedUnits) || consumedUnits < 0 ||
    (remainingUnits !== null && (!Number.isInteger(remainingUnits) || remainingUnits < 0)) ||
    (grantedUnits !== null && remainingUnits === null)
  ) return null;
  const benefitKind = data.benefitKind === 'access' ||
    data.benefitKind === 'usage_credits' ||
    data.benefitKind === 'recurring_delivery'
    ? data.benefitKind
    : null;
  if (!benefitKind) return null;
  const state = data.state === 'consumed' ? 'consumed' : 'available';
  return {
    schemaVersion: STORE_SUBSCRIPTION_BENEFIT_SCHEMA_VERSION,
    id: safeIdentity(data.id),
    storeId: safeIdentity(data.storeId),
    subscriptionId: safeIdentity(data.subscriptionId),
    buyerId: safeIdentity(data.buyerId),
    productId: safeIdentity(data.productId),
    productName: clean(data.productName),
    benefitKind,
    providerInvoiceId: safeIdentity(data.providerInvoiceId),
    providerPaymentId: safeIdentity(data.providerPaymentId),
    paidAt: clean(data.paidAt),
    billingPeriodStartsAt: clean(data.billingPeriodStartsAt),
    billingPeriodEndsAt: clean(data.billingPeriodEndsAt),
    grantedUnits,
    consumedUnits,
    remainingUnits,
    state,
    createdAt: clean(data.createdAt),
    updatedAt: clean(data.updatedAt),
  };
};

const assertCycleMatchesSource = (
  cycle: StoreSubscriptionBenefitCycle,
  source: BenefitSourceSubscription
): void => {
  const expectedUnits = source.terms.benefit.kind === 'access'
    ? null
    : source.terms.benefit.unitsPerCycle;
  if (
    cycle.storeId !== source.storeId ||
    cycle.subscriptionId !== source.id ||
    cycle.buyerId !== source.buyerId ||
    cycle.productId !== source.productId ||
    cycle.providerInvoiceId !== source.providerInvoiceId ||
    cycle.providerPaymentId !== source.providerPaymentId ||
    cycle.benefitKind !== source.terms.benefit.kind ||
    cycle.grantedUnits !== expectedUnits
  ) {
    fail(409, 'SUBSCRIPTION_BENEFIT_CYCLE_CONFLICT', 'O ciclo de benefício existente não corresponde à fatura paga.');
  }
};

export const reconcileStoreSubscriptionBenefitCycle = async (
  storeIdInput: unknown,
  subscriptionIdInput: unknown
): Promise<StoreSubscriptionBenefitCycle | null> => {
  const store = await resolveCanonicalStore(storeIdInput);
  const source = await loadBenefitSourceSubscription(store.canonicalStoreId, subscriptionIdInput);
  if (source.ownerUserId !== store.ownerUserId) {
    fail(409, 'SUBSCRIPTION_BENEFIT_OWNER_MISMATCH', 'A assinatura não pertence ao proprietário da loja.');
  }
  if (
    source.state !== 'active' ||
    source.providerPaymentStatus !== 'approved' ||
    source.providerPaymentStatusDetail !== 'accredited' ||
    !source.providerInvoiceId ||
    !source.providerPaymentId ||
    !source.paymentConfirmedAt
  ) {
    return null;
  }

  const cycleId = cycleIdForInvoice(source.providerInvoiceId);
  const reference = adminDb.doc(cyclePath(store.canonicalStoreId, source.id, cycleId));
  return adminDb.runTransaction(async transaction => {
    const existing = await transaction.get(reference);
    if (existing.exists) {
      const cycle = parseCycle(existing.data());
      if (!cycle) {
        fail(409, 'SUBSCRIPTION_BENEFIT_CYCLE_INVALID', 'O ciclo de benefício persistido está inválido.');
      }
      assertCycleMatchesSource(cycle, source);
      return cycle;
    }

    const units = source.terms.benefit.kind === 'access'
      ? null
      : positiveInteger(source.terms.benefit.unitsPerCycle);
    if (source.terms.benefit.kind !== 'access' && units === null) {
      fail(409, 'SUBSCRIPTION_BENEFIT_UNITS_INVALID', 'A quantidade de benefícios do ciclo está inválida.');
    }
    const createdAt = nowIso();
    const cycle: StoreSubscriptionBenefitCycle = {
      schemaVersion: STORE_SUBSCRIPTION_BENEFIT_SCHEMA_VERSION,
      id: cycleId,
      storeId: store.canonicalStoreId,
      subscriptionId: source.id,
      buyerId: source.buyerId,
      productId: source.productId,
      productName: source.productName,
      benefitKind: source.terms.benefit.kind,
      providerInvoiceId: source.providerInvoiceId,
      providerPaymentId: source.providerPaymentId,
      paidAt: source.paymentConfirmedAt,
      billingPeriodStartsAt: source.paymentConfirmedAt,
      billingPeriodEndsAt: billingPeriodEndsAt(source.paymentConfirmedAt, source.terms),
      grantedUnits: units,
      consumedUnits: 0,
      remainingUnits: units,
      state: 'available',
      createdAt,
      updatedAt: createdAt,
    };
    transaction.create(reference, cycle);
    return cycle;
  });
};

const requireOwnedSubscription = async (
  authorization: string,
  storeIdInput: unknown,
  subscriptionIdInput: unknown
): Promise<{ store: CanonicalStoreIdentity; source: BenefitSourceSubscription }> => {
  const identity = await authenticateConsultantRequest(authorization);
  const store = await resolveCanonicalStore(storeIdInput);
  if (identity.uid !== store.ownerUserId) {
    fail(403, 'SUBSCRIPTION_BENEFIT_FORBIDDEN', 'Apenas o proprietário da loja pode registrar o consumo do benefício.');
  }
  const source = await loadBenefitSourceSubscription(store.canonicalStoreId, subscriptionIdInput);
  if (source.ownerUserId !== store.ownerUserId) {
    fail(409, 'SUBSCRIPTION_BENEFIT_OWNER_MISMATCH', 'A assinatura não pertence à loja autenticada.');
  }
  return { store, source };
};

export const listAuthorizedStoreSubscriptionBenefitCycles = async (
  authorization: string,
  body: unknown
): Promise<StoreSubscriptionBenefitCycle[]> => {
  const payload = record(body);
  const { store, source } = await requireOwnedSubscription(
    authorization,
    payload.storeId,
    payload.subscriptionId
  );
  await reconcileStoreSubscriptionBenefitCycle(store.canonicalStoreId, source.id);
  const snapshot = await adminDb
    .collection(`stores/${store.canonicalStoreId}/subscriptions/${source.id}/benefitCycles`)
    .get();
  return snapshot.docs
    .map(doc => parseCycle(doc.data()))
    .filter((cycle): cycle is StoreSubscriptionBenefitCycle => cycle !== null)
    .sort((left, right) => right.paidAt.localeCompare(left.paidAt));
};

export const consumeAuthorizedStoreSubscriptionBenefit = async (
  authorization: string,
  body: unknown
): Promise<ConsumeStoreSubscriptionBenefitResult> => {
  const payload = record(body);
  const { store, source } = await requireOwnedSubscription(
    authorization,
    payload.storeId,
    payload.subscriptionId
  );
  const units = positiveInteger(payload.units);
  if (units === null) {
    fail(400, 'SUBSCRIPTION_BENEFIT_USAGE_UNITS_INVALID', 'Informe uma quantidade inteira positiva para o consumo.');
  }
  const operationId = safeIdentity(payload.operationId);
  if (!operationId) {
    fail(400, 'SUBSCRIPTION_BENEFIT_USAGE_ID_REQUIRED', 'A movimentação precisa de um identificador idempotente.');
  }
  const note = clean(payload.note).slice(0, 240);
  if (source.state !== 'active') {
    fail(409, 'SUBSCRIPTION_BENEFIT_SUBSCRIPTION_NOT_ACTIVE', 'A assinatura precisa estar ativa para consumir benefícios.');
  }

  const cycle = await reconcileStoreSubscriptionBenefitCycle(store.canonicalStoreId, source.id);
  if (!cycle) {
    fail(409, 'SUBSCRIPTION_BENEFIT_CYCLE_NOT_AVAILABLE', 'Ainda não existe um ciclo pago disponível para esta assinatura.');
  }
  if (cycle.benefitKind === 'access' || cycle.remainingUnits === null) {
    fail(409, 'SUBSCRIPTION_BENEFIT_ACCESS_NOT_CONSUMABLE', 'Assinaturas de acesso não consomem unidades.');
  }

  const usageId = `usage_${hash(operationId).slice(0, 40)}`;
  const cycleRef = adminDb.doc(cyclePath(store.canonicalStoreId, source.id, cycle.id));
  const usageRef = adminDb.doc(usagePath(store.canonicalStoreId, source.id, cycle.id, usageId));
  return adminDb.runTransaction(async transaction => {
    const [cycleSnapshot, usageSnapshot] = await Promise.all([
      transaction.get(cycleRef),
      transaction.get(usageRef),
    ]);
    const current = cycleSnapshot.exists ? parseCycle(cycleSnapshot.data()) : null;
    if (!current || current.providerInvoiceId !== source.providerInvoiceId) {
      fail(409, 'SUBSCRIPTION_BENEFIT_CURRENT_CYCLE_MISMATCH', 'O ciclo atual mudou antes do consumo. Atualize a assinatura e tente novamente.');
    }

    if (usageSnapshot.exists) {
      const existing = record(usageSnapshot.data());
      if (
        clean(existing.id) !== usageId ||
        Number(existing.units) !== units ||
        clean(existing.subscriptionId) !== source.id ||
        clean(existing.benefitCycleId) !== current.id
      ) {
        fail(409, 'SUBSCRIPTION_BENEFIT_USAGE_ID_CONFLICT', 'O identificador desta movimentação já foi usado com outros dados.');
      }
      return {
        cycle: current,
        usage: existing as unknown as StoreSubscriptionBenefitUsage,
        duplicate: true,
      };
    }

    if (current.remainingUnits === null || current.remainingUnits < units) {
      fail(409, 'SUBSCRIPTION_BENEFIT_INSUFFICIENT_UNITS', 'O ciclo não possui unidades suficientes para este consumo.');
    }
    const consumedUnits = current.consumedUnits + units;
    const remainingUnits = current.remainingUnits - units;
    const updatedAt = nowIso();
    const next: StoreSubscriptionBenefitCycle = {
      ...current,
      consumedUnits,
      remainingUnits,
      state: remainingUnits === 0 ? 'consumed' : 'available',
      updatedAt,
    };
    const usage: StoreSubscriptionBenefitUsage = {
      schemaVersion: STORE_SUBSCRIPTION_BENEFIT_SCHEMA_VERSION,
      id: usageId,
      storeId: store.canonicalStoreId,
      subscriptionId: source.id,
      benefitCycleId: current.id,
      buyerId: source.buyerId,
      productId: source.productId,
      units,
      note,
      recordedByUserId: store.ownerUserId,
      createdAt: updatedAt,
    };
    transaction.set(cycleRef, next);
    transaction.create(usageRef, usage);
    return { cycle: next, usage, duplicate: false };
  });
};

export const mapStoreSubscriptionBenefitError = (
  error: unknown
): { status: number; body: { error: string; code?: string } } => {
  if (error instanceof StoreSubscriptionBenefitError) {
    return { status: error.status, body: { error: error.message, code: error.code } };
  }
  const message = error instanceof Error ? error.message : String(error);
  if (message.includes('AUTH_REQUIRED')) {
    return { status: 401, body: { error: 'Faça login novamente para continuar.', code: 'AUTH_REQUIRED' } };
  }
  console.error('[Store Subscription Benefit]', error);
  return {
    status: 503,
    body: {
      error: 'Não foi possível atualizar o benefício da assinatura agora.',
      code: 'SUBSCRIPTION_BENEFIT_UNAVAILABLE',
    },
  };
};
