import { adminDb } from '../firebaseAdmin.js';
import {
  simulateFiscalHomologationPreflight,
  type FiscalCanonicalPaymentEvidence,
  type FiscalHomologationIssuerIdentityEvidence,
  type FiscalHomologationPolicyEvidence,
  type FiscalHomologationPreflightSimulationResult,
  type FiscalOperationalTriggerEvidence,
  type FiscalPaymentEvidenceConsistency,
} from '../../shared/fiscalHomologationPreflightSimulation.js';
import {
  parseFiscalHomologationPolicyDraft,
  resolveFiscalHomologationPolicy,
  type FiscalHomologationOperationScope,
} from '../../shared/fiscalHomologationPolicy.js';
import {
  buildCanonicalOrderFinancialProjection,
  type CanonicalOrderPaymentEvidence,
} from '../../shared/canonicalOrderFinancialProjection.js';
import type {
  CommerceChannel,
  FiscalItemPreparation,
} from '../../shared/channelAvailabilityFiscalFoundation.js';
import { classifyCompatiblePaymentRecord } from '../payments/paymentRecordCompatibility.js';
import { summarizeLocalOrderPayable } from '../attendance/localOrderPayable.js';
import {
  getBrazilFiscalTaxIdentifierKind,
  isValidBrazilFiscalTaxIdentifier,
  normalizeBrazilFiscalTaxIdentifier,
} from '../../src/utils/brazilFiscalIdentifier.js';

const FISCAL_UNITS = new Set([
  'UN', 'KG', 'G', 'L', 'ML', 'CX', 'PCT', 'M', 'M2', 'M3',
]);
const GOODS_ORIGINS = new Set(['0', '1', '2', '3', '4', '5', '6', '7', '8']);
const ORDER_ID_PATTERN = /^[a-zA-Z0-9:_-]{1,240}$/;
const MAX_PAYMENT_RECORDS_PER_ORDER = 50;

const clean = (value: unknown, maxLength = 240): string =>
  typeof value === 'string' ? value.trim().slice(0, maxLength) : '';

const record = (value: unknown): Record<string, unknown> =>
  value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};

const parseChannel = (value: unknown): CommerceChannel =>
  value === 'kyrub' ||
  value === 'mercado_livre' ||
  value === '99food' ||
  value === 'other'
    ? value
    : 'other';

const validGtinChecksum = (value: string): boolean => {
  if (![8, 12, 13, 14].includes(value.length) || !/^\d+$/.test(value)) return false;
  const digits = value.split('').map(Number);
  const checkDigit = digits.pop();
  if (typeof checkDigit !== 'number') return false;
  const sum = digits
    .reverse()
    .reduce((total, digit, index) => total + digit * (index % 2 === 0 ? 3 : 1), 0);
  return (10 - (sum % 10)) % 10 === checkDigit;
};

const fiscalProfileReady = (
  value: unknown,
  kind: FiscalItemPreparation['kind']
): boolean => {
  const profile = record(value);
  if (
    profile.enabled !== true ||
    profile.kind !== kind ||
    !clean(profile.fiscalDescription, 200)
  ) return false;

  if (kind === 'service') {
    return Boolean(
      clean(profile.serviceListCode, 20) ||
      clean(profile.municipalServiceCode, 30)
    );
  }

  const ncm = clean(profile.ncm, 8);
  const cest = clean(profile.cest, 7);
  const commercialUnit = clean(profile.commercialUnit, 4);
  const taxUnit = clean(profile.taxUnit, 4);
  const conversionFactor = profile.conversionFactor;
  const origin = clean(profile.origin, 1);
  if (
    !/^\d{8}$/.test(ncm) ||
    (cest && !/^\d{7}$/.test(cest)) ||
    !FISCAL_UNITS.has(commercialUnit) ||
    !FISCAL_UNITS.has(taxUnit) ||
    typeof conversionFactor !== 'number' ||
    !Number.isFinite(conversionFactor) ||
    conversionFactor <= 0 ||
    conversionFactor > 1_000_000 ||
    !GOODS_ORIGINS.has(origin)
  ) return false;

  if (profile.noGtin === true) return true;
  if (profile.noGtin !== false) return false;
  return validGtinChecksum(clean(profile.gtin, 14));
};

const fiscalIssuerIdentityFromTenant = (
  tenant: Record<string, unknown>
): FiscalHomologationIssuerIdentityEvidence => {
  const operationalSettings = record(tenant.operationalSettings);
  const canonicalProfile = record(operationalSettings.fiscalIssuerProfile);
  const integrations = record(operationalSettings.integrations);
  const sefaz = record(integrations.sefaz);
  const hasCanonicalProfile = Object.keys(canonicalProfile).length > 0;
  const source = hasCanonicalProfile ? canonicalProfile : {
    legalName: sefaz.accountLabel,
    taxIdentifier: sefaz.externalStoreId,
    environment: sefaz.environment,
  };
  const legalName = clean(source.legalName, 120);
  const taxIdentifier = clean(source.taxIdentifier, 120);
  const kind = getBrazilFiscalTaxIdentifierKind(taxIdentifier);
  const ready = Boolean(
    legalName &&
    kind !== 'unknown' &&
    isValidBrazilFiscalTaxIdentifier(taxIdentifier)
  );

  return {
    status: ready ? 'ready' : 'required',
    identifierKind: ready && kind !== 'unknown' ? kind : null,
    environment: source.environment === 'production' ? 'production' : 'sandbox',
  };
};

export interface FiscalConsumerIdentityEvidence {
  status: 'identified' | 'not_provided';
  identifierKind: 'cpf' | 'cnpj' | null;
  maskedTaxIdentifier: string | null;
}

const maskTaxIdentifier = (normalized: string): string => {
  const suffix = normalized.slice(-4);
  return `${'•'.repeat(Math.max(0, normalized.length - suffix.length))}${suffix}`;
};

const fiscalConsumerIdentityFromOrder = (
  order: Record<string, unknown>
): FiscalConsumerIdentityEvidence => {
  const identity = record(order.fiscalConsumerIdentity);
  if (Object.keys(identity).length === 0) {
    return {
      status: 'not_provided',
      identifierKind: null,
      maskedTaxIdentifier: null,
    };
  }

  const taxIdentifier = normalizeBrazilFiscalTaxIdentifier(
    clean(identity.taxIdentifier, 32)
  );
  const kind = getBrazilFiscalTaxIdentifierKind(taxIdentifier);
  if (
    identity.schemaVersion !== 1 ||
    identity.status !== 'identified' ||
    identity.source !== 'staff_checkout' ||
    (kind !== 'cpf' && kind !== 'cnpj') ||
    identity.identifierKind !== kind ||
    !isValidBrazilFiscalTaxIdentifier(taxIdentifier)
  ) {
    throw new Error('FISCAL_PREFLIGHT_ORDER_INTEGRITY_INVALID');
  }

  return {
    status: 'identified',
    identifierKind: kind,
    maskedTaxIdentifier: maskTaxIdentifier(taxIdentifier),
  };
};

interface CanonicalOrderFiscalEvidence {
  sourceChannel: CommerceChannel;
  paymentStatus: string;
  consumerIdentity: FiscalConsumerIdentityEvidence;
  operationScope: FiscalHomologationOperationScope;
  expectedAmount: number;
  hasOperationalPaidQuantity: boolean;
  items: Array<{ productId: string; kind: FiscalItemPreparation['kind'] }>;
}

const parseCanonicalOrderFiscalEvidence = (
  value: unknown,
  expectedOrderId: string
): CanonicalOrderFiscalEvidence => {
  const order = record(value);
  const persistedOrderId = clean(order.id);
  if (persistedOrderId && persistedOrderId !== expectedOrderId) {
    throw new Error('FISCAL_PREFLIGHT_ORDER_INTEGRITY_INVALID');
  }
  if (!Array.isArray(order.items) || order.items.length === 0) {
    throw new Error('FISCAL_PREFLIGHT_ORDER_INVALID');
  }

  const itemsByProductId: Record<string, FiscalItemPreparation['kind']> = {};
  for (const rawItem of order.items) {
    const item = record(rawItem);
    const productId = clean(item.productId, 128);
    if (!/^[a-zA-Z0-9_-]{1,128}$/.test(productId)) {
      throw new Error('FISCAL_PREFLIGHT_ORDER_INVALID');
    }
    const kind: FiscalItemPreparation['kind'] = item.isService === true
      ? 'service'
      : 'goods';
    const existingKind = itemsByProductId[productId];
    if (existingKind && existingKind !== kind) {
      throw new Error('FISCAL_PREFLIGHT_ORDER_INTEGRITY_INVALID');
    }
    itemsByProductId[productId] = kind;
  }

  const items = Object.entries(itemsByProductId).map(([productId, kind]) => ({
    productId,
    kind,
  }));
  const kinds = new Set(items.map(item => item.kind));
  const operationScope: FiscalHomologationOperationScope = kinds.size > 1
    ? 'mixed'
    : kinds.has('service')
      ? 'service'
      : 'goods';

  let payable;
  try {
    payable = summarizeLocalOrderPayable(order);
  } catch {
    throw new Error('FISCAL_PREFLIGHT_ORDER_INVALID');
  }

  return {
    sourceChannel: parseChannel(order.sourceChannel),
    paymentStatus: clean(order.paymentStatus, 40),
    consumerIdentity: fiscalConsumerIdentityFromOrder(order),
    operationScope,
    expectedAmount: payable.billableAmount,
    hasOperationalPaidQuantity: payable.hasOperationalPaidQuantity,
    items,
  };
};

const emptyPolicyEvidence = (
  canonicalStoreId: string
): FiscalHomologationPolicyEvidence => ({
  status: 'missing',
  policyId: null,
  version: null,
  policyReference: null,
  effectiveFrom: null,
  operationScope: null,
  documentFamily: null,
  operationalTrigger: null,
  environment: 'sandbox',
  authority: 'canonical_homologation_policy_registry',
  sourcePath: `stores/${canonicalStoreId}/fiscalPolicies/homologation`,
});

const loadHomologationPolicyEvidence = async (
  canonicalStoreId: string
): Promise<FiscalHomologationPolicyEvidence> => {
  const sourcePath = `stores/${canonicalStoreId}/fiscalPolicies/homologation`;
  const snapshot = await adminDb.doc(sourcePath).get();
  if (!snapshot.exists) return emptyPolicyEvidence(canonicalStoreId);

  const stored = record(snapshot.data());
  const rawResolution = record(stored.resolution);
  const rawPolicy = record(rawResolution.policy);

  if (
    stored.schemaVersion !== 1 ||
    clean(stored.canonicalStoreId, 160) !== canonicalStoreId ||
    rawResolution.schemaVersion !== 1 ||
    rawPolicy.schemaVersion !== 1 ||
    clean(rawPolicy.storeId, 160) !== canonicalStoreId ||
    rawPolicy.environment !== 'sandbox' ||
    rawPolicy.authority !== 'explicit_accounting_policy_for_homologation' ||
    rawPolicy.emissionAuthority !== 'none_homologation_only' ||
    rawPolicy.providerCallAllowed !== false ||
    rawPolicy.sefazCallAllowed !== false ||
    rawResolution.executableInProduction !== false ||
    rawResolution.emissionAuthority !== 'none_homologation_only' ||
    rawResolution.providerCallAllowed !== false ||
    rawResolution.sefazCallAllowed !== false ||
    rawResolution.authority !== 'structural_homologation_policy_validation_only'
  ) {
    throw new Error('FISCAL_PREFLIGHT_HOMOLOGATION_POLICY_INVALID');
  }

  const parsed = parseFiscalHomologationPolicyDraft({
    policyId: clean(rawPolicy.policyId, 160),
    storeId: clean(rawPolicy.storeId, 160),
    version: typeof rawPolicy.version === 'number' ? rawPolicy.version : 1,
    status: rawPolicy.status === 'approved_for_homologation'
      ? 'approved_for_homologation'
      : 'draft',
    policyReference: clean(rawPolicy.policyReference, 160),
    effectiveFrom: clean(rawPolicy.effectiveFrom, 64),
    operationScope:
      rawPolicy.operationScope === 'goods' ||
      rawPolicy.operationScope === 'service' ||
      rawPolicy.operationScope === 'mixed'
        ? rawPolicy.operationScope
        : null,
    documentFamily:
      rawPolicy.documentFamily === 'nfe' ||
      rawPolicy.documentFamily === 'nfce' ||
      rawPolicy.documentFamily === 'nfse'
        ? rawPolicy.documentFamily
        : null,
    operationalTrigger:
      rawPolicy.operationalTrigger === 'payment_confirmed' ||
      rawPolicy.operationalTrigger === 'fulfillment_confirmed' ||
      rawPolicy.operationalTrigger === 'service_completed'
        ? rawPolicy.operationalTrigger
        : null,
  });
  const resolved = resolveFiscalHomologationPolicy(parsed);
  if (rawResolution.resolutionStatus !== resolved.resolutionStatus) {
    throw new Error('FISCAL_PREFLIGHT_HOMOLOGATION_POLICY_INVALID');
  }

  const approved =
    resolved.resolutionStatus === 'ready_for_homologation' &&
    parsed.status === 'approved_for_homologation';

  return {
    status: approved ? 'approved' : 'draft',
    policyId: parsed.policyId,
    version: parsed.version,
    policyReference: parsed.policyReference || null,
    effectiveFrom: parsed.effectiveFrom,
    operationScope: parsed.operationScope,
    documentFamily: parsed.documentFamily,
    operationalTrigger: parsed.operationalTrigger,
    environment: 'sandbox',
    authority: 'canonical_homologation_policy_registry',
    sourcePath,
  };
};

const resolvePaymentConsistency = (input: {
  paymentStatus: string;
  hasOperationalPaidQuantity: boolean;
  canonicalState: FiscalCanonicalPaymentEvidence['projection']['state'];
  paymentHistoryLimitReached: boolean;
}): FiscalPaymentEvidenceConsistency => {
  if (input.paymentHistoryLimitReached) return 'payment_history_limit_reached';
  if (input.hasOperationalPaidQuantity) {
    return 'mixed_authority_requires_reconciliation';
  }

  const operationalStatus = input.paymentStatus === 'paid' || input.paymentStatus === 'partial'
    ? input.paymentStatus
    : 'unpaid';
  if (operationalStatus === 'paid' && input.canonicalState !== 'paid') {
    return 'line_settlement_ahead';
  }
  if (
    operationalStatus === 'partial' &&
    input.canonicalState !== 'partial' &&
    input.canonicalState !== 'paid'
  ) {
    return 'line_settlement_ahead';
  }
  if (
    operationalStatus === 'unpaid' &&
    (input.canonicalState === 'partial' || input.canonicalState === 'paid')
  ) {
    return 'canonical_ahead';
  }
  if (operationalStatus === 'partial' && input.canonicalState === 'paid') {
    return 'canonical_ahead';
  }
  return 'aligned';
};

const loadCanonicalPaymentEvidence = async (input: {
  canonicalStoreId: string;
  orderId: string;
  expectedAmount: number;
  paymentStatus: string;
  hasOperationalPaidQuantity: boolean;
}): Promise<FiscalCanonicalPaymentEvidence> => {
  const snapshot = await adminDb
    .collection(`stores/${input.canonicalStoreId}/payments`)
    .where('orderId', '==', input.orderId)
    .limit(MAX_PAYMENT_RECORDS_PER_ORDER)
    .get();

  const payments: CanonicalOrderPaymentEvidence[] = [];
  let ignoredLegacyMirrorCount = 0;
  for (const document of snapshot.docs) {
    const compatible = classifyCompatiblePaymentRecord(
      document.data(),
      input.canonicalStoreId
    );
    if (compatible.kind === 'legacy_table_payment_mirror') {
      ignoredLegacyMirrorCount += 1;
      continue;
    }
    if (compatible.payment.orderId !== input.orderId) {
      throw new Error('FISCAL_PREFLIGHT_PAYMENT_SCOPE_INVALID');
    }
    payments.push({
      amount: compatible.payment.amount,
      status: compatible.payment.status,
    });
  }

  const projection = buildCanonicalOrderFinancialProjection({
    expectedAmount: input.expectedAmount,
    payments,
  });
  const consistency = resolvePaymentConsistency({
    paymentStatus: input.paymentStatus,
    hasOperationalPaidQuantity: input.hasOperationalPaidQuantity,
    canonicalState: projection.state,
    paymentHistoryLimitReached: snapshot.size >= MAX_PAYMENT_RECORDS_PER_ORDER,
  });

  return {
    projection,
    consistency,
    ignoredLegacyMirrorCount,
  };
};

const resolveOperationalTriggerEvidence = async (input: {
  canonicalStoreId: string;
  orderId: string;
  order: CanonicalOrderFiscalEvidence;
  policy: FiscalHomologationPolicyEvidence;
}): Promise<FiscalOperationalTriggerEvidence> => {
  if (input.policy.status !== 'approved' || !input.policy.operationalTrigger) {
    return {
      trigger: input.policy.operationalTrigger,
      satisfied: false,
      authority: 'homologation_policy_required',
      payment: null,
    };
  }

  if (input.policy.operationalTrigger !== 'payment_confirmed') {
    return {
      trigger: input.policy.operationalTrigger,
      satisfied: false,
      authority: 'not_implemented_fail_closed',
      payment: null,
    };
  }

  const payment = await loadCanonicalPaymentEvidence({
    canonicalStoreId: input.canonicalStoreId,
    orderId: input.orderId,
    expectedAmount: input.order.expectedAmount,
    paymentStatus: input.order.paymentStatus,
    hasOperationalPaidQuantity: input.order.hasOperationalPaidQuantity,
  });
  const consistencySafe =
    payment.consistency === 'aligned' || payment.consistency === 'canonical_ahead';

  return {
    trigger: 'payment_confirmed',
    satisfied: payment.projection.state === 'paid' && consistencySafe,
    authority: 'canonical_payment_projection',
    payment,
  };
};

export interface CanonicalFiscalPreflightReadResult {
  schemaVersion: 3;
  readAuthority: 'server_canonical_read_only';
  canonicalStoreId: string;
  evidence: {
    orderId: string;
    sourceChannel: CommerceChannel;
    paymentStatus: string;
    operationScope: FiscalHomologationOperationScope;
    commercialConfirmation: boolean;
    commercialConfirmationAuthority:
      | 'canonical_payment_projection'
      | 'not_applicable_or_unresolved';
    issuerIdentity: FiscalHomologationIssuerIdentityEvidence;
    issuerIdentityAuthority: 'tenant_operational_settings_fiscal_issuer_profile';
    consumerIdentity: FiscalConsumerIdentityEvidence;
    consumerIdentityAuthority: 'canonical_order_fiscal_consumer_identity';
    productPreparation: FiscalItemPreparation[];
    homologationPolicy: FiscalHomologationPolicyEvidence;
    operationalTrigger: FiscalOperationalTriggerEvidence;
  };
  simulation: FiscalHomologationPreflightSimulationResult;
}

export const loadCanonicalFiscalPreflight = async (input: {
  tenantId: string;
  requestedByUserId: string;
  orderId: string;
  now?: Date;
}): Promise<CanonicalFiscalPreflightReadResult> => {
  const tenantId = clean(input.tenantId, 160);
  const requestedByUserId = clean(input.requestedByUserId, 160);
  const orderId = clean(input.orderId, 240);
  if (!tenantId || tenantId !== requestedByUserId) {
    throw new Error('STORE_CONNECTION_FORBIDDEN');
  }
  if (!ORDER_ID_PATTERN.test(orderId)) {
    throw new Error('FISCAL_PREFLIGHT_ORDER_ID_INVALID');
  }

  const [tenantSnapshot, inventorySnapshot] = await Promise.all([
    adminDb.doc(`tenants/${tenantId}`).get(),
    adminDb.doc(`users/${tenantId}/private_store/inventory`).get(),
  ]);
  const tenant = record(tenantSnapshot.data());
  const canonicalStoreId = clean(tenant.canonicalStoreId, 160);
  if (!canonicalStoreId) {
    throw new Error('FISCAL_PREFLIGHT_CANONICAL_STORE_REQUIRED');
  }

  const [orderSnapshot, policy] = await Promise.all([
    adminDb.doc(`stores/${canonicalStoreId}/orders/${orderId}`).get(),
    loadHomologationPolicyEvidence(canonicalStoreId),
  ]);
  if (!orderSnapshot.exists) {
    throw new Error('FISCAL_PREFLIGHT_ORDER_NOT_FOUND');
  }

  const order = parseCanonicalOrderFiscalEvidence(orderSnapshot.data(), orderId);
  const inventory = record(inventorySnapshot.data());
  const fiscalProfiles = record(inventory.productFiscalProfiles);
  const productPreparation = order.items.map(item => ({
    ...item,
    fiscalProfileReady: fiscalProfileReady(fiscalProfiles[item.productId], item.kind),
  }));
  const issuerIdentity = fiscalIssuerIdentityFromTenant(tenant);
  const operationalTrigger = await resolveOperationalTriggerEvidence({
    canonicalStoreId,
    orderId,
    order,
    policy,
  });
  const simulatedAt = (input.now ?? new Date()).toISOString();

  // Legacy authority intentionally retired: order.paymentStatus === 'paid' must
  // never drive fiscal readiness. The string remains informational evidence only.
  const commercialConfirmation =
    operationalTrigger.trigger === 'payment_confirmed' && operationalTrigger.satisfied;

  const simulation = simulateFiscalHomologationPreflight({
    storeId: canonicalStoreId,
    orderId,
    sourceChannel: order.sourceChannel,
    simulatedAt,
    orderScope: order.operationScope,
    issuerIdentity,
    policy,
    triggerEvidence: operationalTrigger,
    items: productPreparation,
  });

  return {
    schemaVersion: 3,
    readAuthority: 'server_canonical_read_only',
    canonicalStoreId,
    evidence: {
      orderId,
      sourceChannel: order.sourceChannel,
      paymentStatus: order.paymentStatus,
      operationScope: order.operationScope,
      commercialConfirmation,
      commercialConfirmationAuthority:
        operationalTrigger.trigger === 'payment_confirmed'
          ? 'canonical_payment_projection'
          : 'not_applicable_or_unresolved',
      issuerIdentity,
      issuerIdentityAuthority: 'tenant_operational_settings_fiscal_issuer_profile',
      consumerIdentity: order.consumerIdentity,
      consumerIdentityAuthority: 'canonical_order_fiscal_consumer_identity',
      productPreparation,
      homologationPolicy: policy,
      operationalTrigger,
    },
    simulation,
  };
};
