import { adminDb } from '../firebaseAdmin.js';
import { authenticateConsultantRequest } from '../ai/consultantAuth.js';
import {
  StoreSubscriptionBenefitError,
  reconcileStoreSubscriptionBenefitCycle,
} from './storeSubscriptionBenefitService.js';
import {
  STORE_SUBSCRIPTION_BENEFIT_SCHEMA_VERSION,
  type StoreSubscriptionBenefitCycle,
  type StoreSubscriptionBenefitLedgerSnapshot,
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
const fail = (status: number, code: string, message: string): never => {
  throw new StoreSubscriptionBenefitError(status, code, message);
};

interface CanonicalStoreIdentity {
  canonicalStoreId: string;
  ownerUserId: string;
}

const resolveCanonicalStore = async (storeReference: unknown): Promise<CanonicalStoreIdentity> => {
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
  if (!canonicalStoreId || !ownerUserId) {
    fail(409, 'SUBSCRIPTION_BENEFIT_STORE_IDENTITY_INVALID', 'A identidade da loja está inconsistente.');
  }
  return { canonicalStoreId, ownerUserId };
};

const parseCycle = (value: unknown): StoreSubscriptionBenefitCycle | null => {
  const data = record(value);
  const grantedUnits = data.grantedUnits === null ? null : Number(data.grantedUnits);
  const consumedUnits = Number(data.consumedUnits);
  const remainingUnits = data.remainingUnits === null ? null : Number(data.remainingUnits);
  const benefitKind =
    data.benefitKind === 'access' ||
    data.benefitKind === 'usage_credits' ||
    data.benefitKind === 'recurring_delivery'
      ? data.benefitKind
      : null;
  if (
    data.schemaVersion !== STORE_SUBSCRIPTION_BENEFIT_SCHEMA_VERSION ||
    !safeIdentity(data.id) ||
    !safeIdentity(data.storeId) ||
    !safeIdentity(data.subscriptionId) ||
    !safeIdentity(data.buyerId) ||
    !safeIdentity(data.productId) ||
    !safeIdentity(data.providerInvoiceId) ||
    !safeIdentity(data.providerPaymentId) ||
    !benefitKind ||
    !Number.isInteger(consumedUnits) || consumedUnits < 0 ||
    (grantedUnits !== null && (!Number.isInteger(grantedUnits) || grantedUnits <= 0)) ||
    (remainingUnits !== null && (!Number.isInteger(remainingUnits) || remainingUnits < 0))
  ) return null;

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
    state: data.state === 'consumed' ? 'consumed' : 'available',
    createdAt: clean(data.createdAt),
    updatedAt: clean(data.updatedAt),
  };
};

const parseUsage = (value: unknown): StoreSubscriptionBenefitUsage | null => {
  const data = record(value);
  const units = Number(data.units);
  if (
    data.schemaVersion !== STORE_SUBSCRIPTION_BENEFIT_SCHEMA_VERSION ||
    !safeIdentity(data.id) ||
    !safeIdentity(data.storeId) ||
    !safeIdentity(data.subscriptionId) ||
    !safeIdentity(data.benefitCycleId) ||
    !safeIdentity(data.buyerId) ||
    !safeIdentity(data.productId) ||
    !safeIdentity(data.recordedByUserId) ||
    !Number.isInteger(units) || units <= 0
  ) return null;

  return {
    schemaVersion: STORE_SUBSCRIPTION_BENEFIT_SCHEMA_VERSION,
    id: safeIdentity(data.id),
    storeId: safeIdentity(data.storeId),
    subscriptionId: safeIdentity(data.subscriptionId),
    benefitCycleId: safeIdentity(data.benefitCycleId),
    buyerId: safeIdentity(data.buyerId),
    productId: safeIdentity(data.productId),
    units,
    note: clean(data.note),
    recordedByUserId: safeIdentity(data.recordedByUserId),
    createdAt: clean(data.createdAt),
  };
};

export const loadAuthorizedStoreSubscriptionBenefitLedger = async (
  authorization: string,
  body: unknown
): Promise<StoreSubscriptionBenefitLedgerSnapshot> => {
  const identity = await authenticateConsultantRequest(authorization);
  const payload = record(body);
  const store = await resolveCanonicalStore(payload.storeId);
  if (identity.uid !== store.ownerUserId) {
    fail(403, 'SUBSCRIPTION_BENEFIT_FORBIDDEN', 'Apenas o proprietário da loja pode consultar os benefícios.');
  }

  const subscriptionId = safeIdentity(payload.subscriptionId);
  if (!subscriptionId) {
    fail(400, 'SUBSCRIPTION_BENEFIT_SUBSCRIPTION_REQUIRED', 'A assinatura não foi identificada.');
  }

  const subscription = await adminDb
    .doc(`stores/${store.canonicalStoreId}/subscriptions/${subscriptionId}`)
    .get();
  if (!subscription.exists) {
    fail(404, 'SUBSCRIPTION_BENEFIT_SUBSCRIPTION_NOT_FOUND', 'A assinatura não foi encontrada.');
  }
  if (safeIdentity(subscription.data()?.ownerUserId) !== store.ownerUserId) {
    fail(409, 'SUBSCRIPTION_BENEFIT_OWNER_MISMATCH', 'A assinatura não pertence à loja autenticada.');
  }

  const currentCycle = await reconcileStoreSubscriptionBenefitCycle(
    store.canonicalStoreId,
    subscriptionId
  );
  const cyclesSnapshot = await adminDb
    .collection(`stores/${store.canonicalStoreId}/subscriptions/${subscriptionId}/benefitCycles`)
    .get();
  const cycles = cyclesSnapshot.docs
    .map(doc => parseCycle(doc.data()))
    .filter((cycle): cycle is StoreSubscriptionBenefitCycle => cycle !== null)
    .sort((left, right) => right.paidAt.localeCompare(left.paidAt));

  const usageGroups = await Promise.all(
    cycles.map(async cycle => {
      const usagesSnapshot = await adminDb
        .collection(`stores/${store.canonicalStoreId}/subscriptions/${subscriptionId}/benefitCycles/${cycle.id}/usages`)
        .get();
      return usagesSnapshot.docs
        .map(doc => parseUsage(doc.data()))
        .filter((usage): usage is StoreSubscriptionBenefitUsage => usage !== null);
    })
  );

  const usages = usageGroups
    .flat()
    .sort((left, right) => right.createdAt.localeCompare(left.createdAt));

  return {
    subscriptionId,
    currentCycleId: currentCycle?.id ?? null,
    cycles,
    usages,
  };
};
