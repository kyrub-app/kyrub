import { adminDb } from '../firebaseAdmin.js';
import {
  simulateFiscalPreflight,
  type FiscalSimulationIssuerIdentityEvidence,
  type FiscalSimulationResult,
} from '../../shared/fiscalSimulation.js';
import type {
  CommerceChannel,
  FiscalAccountingDecisionEvidenceInput,
  FiscalItemPreparation,
} from '../../shared/channelAvailabilityFiscalFoundation.js';
import {
  getBrazilFiscalTaxIdentifierKind,
  isValidBrazilFiscalTaxIdentifier,
} from '../../src/utils/brazilFiscalIdentifier.js';

const FISCAL_UNITS = new Set([
  'UN', 'KG', 'G', 'L', 'ML', 'CX', 'PCT', 'M', 'M2', 'M3',
]);
const GOODS_ORIGINS = new Set(['0', '1', '2', '3', '4', '5', '6', '7', '8']);
const ORDER_ID_PATTERN = /^[a-zA-Z0-9:_-]{1,240}$/;

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

const accountingDecisionFromTenant = (
  tenant: Record<string, unknown>
): FiscalAccountingDecisionEvidenceInput | undefined => {
  const operationalSettings = record(tenant.operationalSettings);
  const decision = record(operationalSettings.fiscalAccountingDecision);
  const policyReference = clean(decision.policyReference, 120);
  const recordedAt = clean(decision.recordedAt, 64);
  if (
    decision.status !== 'recorded' ||
    !policyReference ||
    !recordedAt ||
    !Number.isFinite(Date.parse(recordedAt))
  ) return undefined;
  return {
    status: 'recorded',
    policyReference,
    recordedAt,
  };
};

const fiscalIssuerIdentityFromTenant = (
  tenant: Record<string, unknown>
): FiscalSimulationIssuerIdentityEvidence => {
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
    identifierKind: ready ? kind : null,
    environment: source.environment === 'production' ? 'production' : 'sandbox',
  };
};

interface CanonicalOrderFiscalEvidence {
  sourceChannel: CommerceChannel;
  paymentStatus: string;
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

  return {
    sourceChannel: parseChannel(order.sourceChannel),
    paymentStatus: clean(order.paymentStatus, 40),
    items: Object.entries(itemsByProductId).map(([productId, kind]) => ({
      productId,
      kind,
    })),
  };
};

export interface CanonicalFiscalPreflightReadResult {
  schemaVersion: 2;
  readAuthority: 'server_canonical_read_only';
  canonicalStoreId: string;
  evidence: {
    orderId: string;
    sourceChannel: CommerceChannel;
    paymentStatus: string;
    commercialConfirmation: boolean;
    commercialConfirmationAuthority: 'canonical_order_payment_status';
    issuerIdentity: FiscalSimulationIssuerIdentityEvidence;
    issuerIdentityAuthority: 'tenant_operational_settings_fiscal_issuer_profile';
    productPreparation: FiscalItemPreparation[];
    accountingDecision: FiscalSimulationResult['candidate']['accountingDecisionEvidence'];
  };
  simulation: FiscalSimulationResult;
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

  const orderSnapshot = await adminDb
    .doc(`stores/${canonicalStoreId}/orders/${orderId}`)
    .get();
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
  const accountingDecision = accountingDecisionFromTenant(tenant);
  const issuerIdentity = fiscalIssuerIdentityFromTenant(tenant);
  const commerciallyConfirmed = order.paymentStatus === 'paid';
  const simulatedAt = (input.now ?? new Date()).toISOString();

  const simulation = simulateFiscalPreflight({
    storeId: canonicalStoreId,
    orderId,
    sourceChannel: order.sourceChannel,
    commerciallyConfirmed,
    issuerIdentity,
    accountingDecision,
    items: productPreparation,
    simulatedAt,
  });

  return {
    schemaVersion: 2,
    readAuthority: 'server_canonical_read_only',
    canonicalStoreId,
    evidence: {
      orderId,
      sourceChannel: order.sourceChannel,
      paymentStatus: order.paymentStatus,
      commercialConfirmation: commerciallyConfirmed,
      commercialConfirmationAuthority: 'canonical_order_payment_status',
      issuerIdentity,
      issuerIdentityAuthority: 'tenant_operational_settings_fiscal_issuer_profile',
      productPreparation,
      accountingDecision: simulation.candidate.accountingDecisionEvidence,
    },
    simulation,
  };
};
