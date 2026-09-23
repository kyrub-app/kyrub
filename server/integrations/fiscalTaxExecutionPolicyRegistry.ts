import { FieldValue } from 'firebase-admin/firestore';
import { adminDb } from '../firebaseAdmin.js';
import type { FiscalHomologationDocumentFamily } from '../../shared/fiscalHomologationPolicy.js';
import {
  FISCAL_TAX_EXECUTION_POLICY_SCHEMA_VERSION,
  isFiscalTaxExecutionPolicyEffective,
  validateFiscalGoodsLineTaxRule,
  validateFiscalServiceLineTaxRule,
  type FiscalGoodsLineTaxRule,
  type FiscalOperationExecutionPolicy,
  type FiscalServiceLineTaxRule,
  type FiscalTaxExecutionPolicy,
} from '../../shared/fiscalTaxExecutionPolicy.js';
import { resolveFiscalHomologationOwnerAuthority } from './fiscalHomologationAttemptLedger.js';

const clean = (value: unknown, maxLength = 240): string =>
  typeof value === 'string' ? value.trim().slice(0, maxLength) : '';

const record = (value: unknown): Record<string, unknown> =>
  value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};

const FAMILY: readonly FiscalHomologationDocumentFamily[] = ['nfe', 'nfce', 'nfse'];
const CURRENT_STATES = new Set(['draft', 'approved_for_homologation']);

const currentPath = (
  canonicalStoreId: string,
  family: FiscalHomologationDocumentFamily
): string => `stores/${canonicalStoreId}/fiscalTaxExecutionPolicies/${family}`;

const revisionPath = (
  canonicalStoreId: string,
  family: FiscalHomologationDocumentFamily,
  version: number
): string => `${currentPath(canonicalStoreId, family)}/revisions/v${String(version).padStart(6, '0')}`;

const parseGoodsOperation = (value: unknown): FiscalOperationExecutionPolicy => {
  const raw = record(value);
  const operationNature = clean(raw.operationNature, 60);
  const documentDirection = raw.documentDirection;
  const destinationLocation = raw.destinationLocation;
  const purpose = raw.purpose;
  const buyerPresence = raw.buyerPresence;
  const freightMode = raw.freightMode;
  const issuerTaxRegime = raw.issuerTaxRegime;
  const recipientIeIndicator = raw.recipientIeIndicator;
  if (
    raw.kind !== 'goods_operation' ||
    !operationNature ||
    (documentDirection !== 'inbound' && documentDirection !== 'outbound') ||
    !['internal', 'interstate', 'foreign'].includes(String(destinationLocation)) ||
    !['normal', 'complementary', 'adjustment', 'return', 'credit', 'debit'].includes(String(purpose)) ||
    typeof raw.finalConsumer !== 'boolean' ||
    !['not_applicable', 'in_person', 'internet', 'telesales', 'home_delivery', 'offsite_in_person', 'other_non_in_person'].includes(String(buyerPresence)) ||
    !['issuer', 'recipient', 'third_party', 'issuer_own', 'recipient_own', 'no_freight'].includes(String(freightMode)) ||
    !['simples_nacional', 'simples_nacional_excess', 'regime_normal', 'mei'].includes(String(issuerTaxRegime)) ||
    (recipientIeIndicator !== null && !['contributor', 'exempt', 'non_contributor'].includes(String(recipientIeIndicator)))
  ) {
    throw new Error('FISCAL_TAX_EXECUTION_OPERATION_INCOMPLETE');
  }
  return {
    kind: 'goods_operation',
    operationNature,
    documentDirection,
    destinationLocation: destinationLocation as 'internal' | 'interstate' | 'foreign',
    purpose: purpose as 'normal' | 'complementary' | 'adjustment' | 'return' | 'credit' | 'debit',
    finalConsumer: raw.finalConsumer,
    buyerPresence: buyerPresence as 'not_applicable' | 'in_person' | 'internet' | 'telesales' | 'home_delivery' | 'offsite_in_person' | 'other_non_in_person',
    freightMode: freightMode as 'issuer' | 'recipient' | 'third_party' | 'issuer_own' | 'recipient_own' | 'no_freight',
    issuerTaxRegime: issuerTaxRegime as 'simples_nacional' | 'simples_nacional_excess' | 'regime_normal' | 'mei',
    recipientIeIndicator: recipientIeIndicator as 'contributor' | 'exempt' | 'non_contributor' | null,
  };
};

const parseServiceOperation = (value: unknown): FiscalOperationExecutionPolicy => {
  const raw = record(value);
  const serviceOperationNature = raw.serviceOperationNature;
  const specialTaxRegime = raw.specialTaxRegime;
  if (
    raw.kind !== 'service_operation' ||
    !['taxed_in_municipality', 'taxed_outside_municipality', 'exempt', 'immune', 'suspended_by_court', 'suspended_by_administration'].includes(String(serviceOperationNature)) ||
    (specialTaxRegime !== null && !['municipal_microenterprise', 'estimated', 'professional_society', 'cooperative', 'mei_simples', 'me_epp_simples'].includes(String(specialTaxRegime))) ||
    typeof raw.simplesNacional !== 'boolean' ||
    typeof raw.culturalIncentive !== 'boolean'
  ) {
    throw new Error('FISCAL_TAX_EXECUTION_OPERATION_INCOMPLETE');
  }
  return {
    kind: 'service_operation',
    serviceOperationNature: serviceOperationNature as 'taxed_in_municipality' | 'taxed_outside_municipality' | 'exempt' | 'immune' | 'suspended_by_court' | 'suspended_by_administration',
    specialTaxRegime: specialTaxRegime as 'municipal_microenterprise' | 'estimated' | 'professional_society' | 'cooperative' | 'mei_simples' | 'me_epp_simples' | null,
    simplesNacional: raw.simplesNacional,
    culturalIncentive: raw.culturalIncentive,
  };
};

const parseGoodsRules = (value: unknown): Record<string, FiscalGoodsLineTaxRule> => {
  const raw = record(value);
  const parsed: Record<string, FiscalGoodsLineTaxRule> = {};
  for (const [productId, candidate] of Object.entries(raw)) {
    const rule = validateFiscalGoodsLineTaxRule({
      ...(record(candidate) as unknown as FiscalGoodsLineTaxRule),
      productId,
    });
    parsed[productId] = rule;
  }
  return parsed;
};

const parseServiceRules = (value: unknown): Record<string, FiscalServiceLineTaxRule> => {
  const raw = record(value);
  const parsed: Record<string, FiscalServiceLineTaxRule> = {};
  for (const [productId, candidate] of Object.entries(raw)) {
    const rule = validateFiscalServiceLineTaxRule({
      ...(record(candidate) as unknown as FiscalServiceLineTaxRule),
      productId,
    });
    parsed[productId] = rule;
  }
  return parsed;
};

const parsePolicy = (
  value: unknown,
  canonicalStoreId: string,
  family: FiscalHomologationDocumentFamily
): FiscalTaxExecutionPolicy => {
  const raw = record(value);
  const version = raw.version;
  const accountingReference = clean(raw.accountingReference, 180);
  const effectiveFrom = clean(raw.effectiveFrom, 64);
  const status = raw.status;
  if (
    raw.schemaVersion !== FISCAL_TAX_EXECUTION_POLICY_SCHEMA_VERSION ||
    clean(raw.storeId, 160) !== canonicalStoreId ||
    clean(raw.policyId, 200) !== `tax-execution:${canonicalStoreId}:${family}` ||
    raw.documentFamily !== family ||
    !CURRENT_STATES.has(String(status)) ||
    typeof version !== 'number' || !Number.isSafeInteger(version) || version <= 0 ||
    !accountingReference ||
    !Number.isFinite(Date.parse(effectiveFrom)) ||
    raw.environment !== 'sandbox' ||
    raw.authority !== 'explicit_accounting_tax_policy_for_homologation'
  ) {
    throw new Error('FISCAL_TAX_EXECUTION_POLICY_STORED_RECORD_INVALID');
  }
  const operation = family === 'nfse'
    ? parseServiceOperation(raw.operation)
    : parseGoodsOperation(raw.operation);
  return {
    schemaVersion: 1,
    policyId: `tax-execution:${canonicalStoreId}:${family}`,
    storeId: canonicalStoreId,
    version,
    status: status as 'draft' | 'approved_for_homologation',
    accountingReference,
    effectiveFrom: new Date(effectiveFrom).toISOString(),
    documentFamily: family,
    operation,
    goodsRules: parseGoodsRules(raw.goodsRules),
    serviceRules: parseServiceRules(raw.serviceRules),
    environment: 'sandbox',
    authority: 'explicit_accounting_tax_policy_for_homologation',
  };
};

export interface SaveFiscalTaxExecutionPolicyInput {
  tenantId: string;
  requestedByUserId: string;
  documentFamily: FiscalHomologationDocumentFamily;
  approveForHomologation?: boolean;
  accountingReference: string;
  effectiveFrom: string;
  operation: FiscalOperationExecutionPolicy;
  goodsRules?: Record<string, FiscalGoodsLineTaxRule>;
  serviceRules?: Record<string, FiscalServiceLineTaxRule>;
  now?: Date;
}

export const loadFiscalTaxExecutionPolicy = async (input: {
  tenantId: string;
  requestedByUserId: string;
  documentFamily: FiscalHomologationDocumentFamily;
}): Promise<FiscalTaxExecutionPolicy | null> => {
  const canonicalStoreId = await resolveFiscalHomologationOwnerAuthority(input);
  if (!FAMILY.includes(input.documentFamily)) throw new Error('FISCAL_TAX_EXECUTION_FAMILY_INVALID');
  const snapshot = await adminDb.doc(currentPath(canonicalStoreId, input.documentFamily)).get();
  return snapshot.exists
    ? parsePolicy(snapshot.data(), canonicalStoreId, input.documentFamily)
    : null;
};

export const saveFiscalTaxExecutionPolicy = async (
  input: SaveFiscalTaxExecutionPolicyInput
): Promise<FiscalTaxExecutionPolicy> => {
  const canonicalStoreId = await resolveFiscalHomologationOwnerAuthority(input);
  const family = input.documentFamily;
  if (!FAMILY.includes(family)) throw new Error('FISCAL_TAX_EXECUTION_FAMILY_INVALID');
  const accountingReference = clean(input.accountingReference, 180);
  const effectiveAt = Date.parse(clean(input.effectiveFrom, 64));
  if (!accountingReference || !Number.isFinite(effectiveAt)) {
    throw new Error('FISCAL_TAX_EXECUTION_POLICY_INCOMPLETE');
  }
  const operation = family === 'nfse'
    ? parseServiceOperation(input.operation)
    : parseGoodsOperation(input.operation);
  const goodsRules = parseGoodsRules(input.goodsRules ?? {});
  const serviceRules = parseServiceRules(input.serviceRules ?? {});
  if (family === 'nfse' && Object.keys(serviceRules).length === 0 && input.approveForHomologation === true) {
    throw new Error('FISCAL_TAX_EXECUTION_POLICY_INCOMPLETE');
  }
  if ((family === 'nfe' || family === 'nfce') && Object.keys(goodsRules).length === 0 && input.approveForHomologation === true) {
    throw new Error('FISCAL_TAX_EXECUTION_POLICY_INCOMPLETE');
  }

  const currentRef = adminDb.doc(currentPath(canonicalStoreId, family));
  const updatedAt = (input.now ?? new Date()).toISOString();
  return adminDb.runTransaction(async transaction => {
    const currentSnapshot = await transaction.get(currentRef);
    const currentRaw = record(currentSnapshot.data());
    const currentVersion = typeof currentRaw.version === 'number' && Number.isSafeInteger(currentRaw.version)
      ? currentRaw.version
      : 0;
    const version = currentVersion + 1;
    const policy: FiscalTaxExecutionPolicy = {
      schemaVersion: 1,
      policyId: `tax-execution:${canonicalStoreId}:${family}`,
      storeId: canonicalStoreId,
      version,
      status: input.approveForHomologation === true ? 'approved_for_homologation' : 'draft',
      accountingReference,
      effectiveFrom: new Date(effectiveAt).toISOString(),
      documentFamily: family,
      operation,
      goodsRules,
      serviceRules,
      environment: 'sandbox',
      authority: 'explicit_accounting_tax_policy_for_homologation',
    };
    const stored = {
      ...policy,
      updatedByUserId: input.requestedByUserId,
      updatedAt,
      serverUpdatedAt: FieldValue.serverTimestamp(),
    };
    transaction.set(currentRef, stored);
    transaction.create(adminDb.doc(revisionPath(canonicalStoreId, family, version)), stored);
    return policy;
  });
};

export const requireEffectiveFiscalTaxExecutionPolicy = async (input: {
  tenantId: string;
  requestedByUserId: string;
  documentFamily: FiscalHomologationDocumentFamily;
  at?: Date;
}): Promise<FiscalTaxExecutionPolicy> => {
  const policy = await loadFiscalTaxExecutionPolicy(input);
  if (!policy || !isFiscalTaxExecutionPolicyEffective(policy, input.at ?? new Date())) {
    throw new Error('FISCAL_TAX_EXECUTION_POLICY_NOT_READY');
  }
  return policy;
};
