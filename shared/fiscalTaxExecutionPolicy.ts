import type { FiscalHomologationDocumentFamily } from './fiscalHomologationPolicy';

export const FISCAL_TAX_EXECUTION_POLICY_SCHEMA_VERSION = 1 as const;

export type FiscalTaxExecutionPolicyStatus =
  | 'draft'
  | 'approved_for_homologation';

export type FiscalDestinationLocation = 'internal' | 'interstate' | 'foreign';
export type FiscalDocumentDirection = 'inbound' | 'outbound';
export type FiscalDocumentPurpose =
  | 'normal'
  | 'complementary'
  | 'adjustment'
  | 'return'
  | 'credit'
  | 'debit';
export type FiscalBuyerPresence =
  | 'not_applicable'
  | 'in_person'
  | 'internet'
  | 'telesales'
  | 'home_delivery'
  | 'offsite_in_person'
  | 'other_non_in_person';
export type FiscalFreightMode =
  | 'issuer'
  | 'recipient'
  | 'third_party'
  | 'issuer_own'
  | 'recipient_own'
  | 'no_freight';
export type FiscalIssuerTaxRegime =
  | 'simples_nacional'
  | 'simples_nacional_excess'
  | 'regime_normal'
  | 'mei';
export type FiscalRecipientIeIndicator =
  | 'contributor'
  | 'exempt'
  | 'non_contributor';

export interface FiscalGoodsOperationPolicy {
  kind: 'goods_operation';
  operationNature: string;
  documentDirection: FiscalDocumentDirection;
  destinationLocation: FiscalDestinationLocation;
  purpose: FiscalDocumentPurpose;
  finalConsumer: boolean;
  buyerPresence: FiscalBuyerPresence;
  freightMode: FiscalFreightMode;
  issuerTaxRegime: FiscalIssuerTaxRegime;
  recipientIeIndicator: FiscalRecipientIeIndicator | null;
}

export type FiscalServiceOperationNature =
  | 'taxed_in_municipality'
  | 'taxed_outside_municipality'
  | 'exempt'
  | 'immune'
  | 'suspended_by_court'
  | 'suspended_by_administration';

export type FiscalServiceSpecialTaxRegime =
  | 'municipal_microenterprise'
  | 'estimated'
  | 'professional_society'
  | 'cooperative'
  | 'mei_simples'
  | 'me_epp_simples';

export interface FiscalServiceOperationPolicy {
  kind: 'service_operation';
  serviceOperationNature: FiscalServiceOperationNature;
  specialTaxRegime: FiscalServiceSpecialTaxRegime | null;
  simplesNacional: boolean;
  culturalIncentive: boolean;
}

export type FiscalOperationExecutionPolicy =
  | FiscalGoodsOperationPolicy
  | FiscalServiceOperationPolicy;

export type FiscalExplicitTaxScalar = string | number | boolean;

export interface FiscalGoodsLineTaxRule {
  productId: string;
  cfop: string;
  icmsSituation: string;
  pisSituation: string;
  cofinsSituation: string;
  ibsCbsSituation: string;
  ibsCbsClassification: string;
  explicitTaxFacts: Record<string, FiscalExplicitTaxScalar>;
}

export interface FiscalServiceLineTaxRule {
  productId: string;
  serviceListCode: string;
  municipalServiceCode: string;
  issRate: number | null;
  issWithheld: boolean | null;
  explicitTaxFacts: Record<string, FiscalExplicitTaxScalar>;
}

export interface FiscalTaxExecutionPolicy {
  schemaVersion: typeof FISCAL_TAX_EXECUTION_POLICY_SCHEMA_VERSION;
  policyId: string;
  storeId: string;
  version: number;
  status: FiscalTaxExecutionPolicyStatus;
  accountingReference: string;
  effectiveFrom: string;
  documentFamily: FiscalHomologationDocumentFamily;
  operation: FiscalOperationExecutionPolicy;
  goodsRules: Record<string, FiscalGoodsLineTaxRule>;
  serviceRules: Record<string, FiscalServiceLineTaxRule>;
  environment: 'sandbox';
  authority: 'explicit_accounting_tax_policy_for_homologation';
}

const clean = (value: unknown, maxLength = 240): string =>
  typeof value === 'string' ? value.trim().slice(0, maxLength) : '';

const productIdPattern = /^[A-Za-z0-9_-]{1,128}$/;
const taxFactKeyPattern = /^[a-z][a-z0-9_]{0,63}$/;

const normalizeExplicitTaxFacts = (
  value: unknown
): Record<string, FiscalExplicitTaxScalar> => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
  const output: Record<string, FiscalExplicitTaxScalar> = {};
  for (const [key, raw] of Object.entries(value as Record<string, unknown>)) {
    if (!taxFactKeyPattern.test(key)) continue;
    if (typeof raw === 'boolean') output[key] = raw;
    else if (typeof raw === 'number' && Number.isFinite(raw)) output[key] = raw;
    else if (typeof raw === 'string' && raw.trim()) output[key] = raw.trim().slice(0, 120);
  }
  return output;
};

export const validateFiscalGoodsLineTaxRule = (
  value: FiscalGoodsLineTaxRule
): FiscalGoodsLineTaxRule => {
  const productId = clean(value.productId, 128);
  if (!productIdPattern.test(productId)) throw new Error('FISCAL_TAX_RULE_PRODUCT_INVALID');
  const cfop = clean(value.cfop, 4);
  const icmsSituation = clean(value.icmsSituation, 20);
  const pisSituation = clean(value.pisSituation, 2);
  const cofinsSituation = clean(value.cofinsSituation, 2);
  const ibsCbsSituation = clean(value.ibsCbsSituation, 3);
  const ibsCbsClassification = clean(value.ibsCbsClassification, 6);
  if (
    !/^\d{4}$/.test(cfop) ||
    !/^[0-9A-Za-z_]{2,20}$/.test(icmsSituation) ||
    !/^\d{2}$/.test(pisSituation) ||
    !/^\d{2}$/.test(cofinsSituation) ||
    !/^\d{3}$/.test(ibsCbsSituation) ||
    !/^\d{6}$/.test(ibsCbsClassification)
  ) {
    throw new Error('FISCAL_TAX_RULE_GOODS_INCOMPLETE');
  }
  return {
    productId,
    cfop,
    icmsSituation,
    pisSituation,
    cofinsSituation,
    ibsCbsSituation,
    ibsCbsClassification,
    explicitTaxFacts: normalizeExplicitTaxFacts(value.explicitTaxFacts),
  };
};

export const validateFiscalServiceLineTaxRule = (
  value: FiscalServiceLineTaxRule
): FiscalServiceLineTaxRule => {
  const productId = clean(value.productId, 128);
  const serviceListCode = clean(value.serviceListCode, 20);
  const municipalServiceCode = clean(value.municipalServiceCode, 30);
  const issRate = value.issRate;
  if (
    !productIdPattern.test(productId) ||
    (!serviceListCode && !municipalServiceCode) ||
    (issRate !== null && (!Number.isFinite(issRate) || issRate < 0 || issRate > 100))
  ) {
    throw new Error('FISCAL_TAX_RULE_SERVICE_INCOMPLETE');
  }
  return {
    productId,
    serviceListCode,
    municipalServiceCode,
    issRate,
    issWithheld: typeof value.issWithheld === 'boolean' ? value.issWithheld : null,
    explicitTaxFacts: normalizeExplicitTaxFacts(value.explicitTaxFacts),
  };
};

export const isFiscalTaxExecutionPolicyEffective = (
  policy: FiscalTaxExecutionPolicy,
  at: Date
): boolean =>
  policy.status === 'approved_for_homologation' &&
  policy.environment === 'sandbox' &&
  Number.isFinite(Date.parse(policy.effectiveFrom)) &&
  Date.parse(policy.effectiveFrom) <= at.getTime();
