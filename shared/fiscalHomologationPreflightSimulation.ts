import type { CommerceChannel, FiscalItemPreparation } from './channelAvailabilityFiscalFoundation';
import type {
  FiscalHomologationDocumentFamily,
  FiscalHomologationOperationScope,
  FiscalHomologationOperationalTrigger,
} from './fiscalHomologationPolicy';
import type { CanonicalOrderFinancialProjection } from './canonicalOrderFinancialProjection';

export type FiscalHomologationPreflightBlockingReason =
  | 'homologation_policy_required'
  | 'homologation_policy_not_effective'
  | 'homologation_policy_scope_mismatch'
  | 'fiscal_issuer_identity_required'
  | 'product_fiscal_preparation_incomplete'
  | 'operational_trigger_not_satisfied';

export type FiscalHomologationPreflightRequiredInput =
  | 'approved_homologation_policy'
  | 'effective_homologation_policy'
  | 'matching_operation_scope'
  | 'fiscal_issuer_identity'
  | 'product_fiscal_preparation'
  | 'authoritative_operational_trigger';

export interface FiscalHomologationIssuerIdentityEvidence {
  status: 'ready' | 'required';
  identifierKind: 'cpf' | 'cnpj' | null;
  environment: 'sandbox' | 'production';
}

export interface FiscalHomologationPolicyEvidence {
  status: 'missing' | 'draft' | 'approved';
  policyId: string | null;
  version: number | null;
  policyReference: string | null;
  effectiveFrom: string | null;
  operationScope: FiscalHomologationOperationScope | null;
  documentFamily: FiscalHomologationDocumentFamily | null;
  operationalTrigger: FiscalHomologationOperationalTrigger | null;
  environment: 'sandbox';
  authority: 'canonical_homologation_policy_registry';
  sourcePath: string;
}

export type FiscalPaymentEvidenceConsistency =
  | 'aligned'
  | 'canonical_ahead'
  | 'line_settlement_ahead'
  | 'mixed_authority_requires_reconciliation'
  | 'payment_history_limit_reached';

export interface FiscalCanonicalPaymentEvidence {
  projection: CanonicalOrderFinancialProjection;
  consistency: FiscalPaymentEvidenceConsistency;
  ignoredLegacyMirrorCount: number;
}

export interface FiscalOperationalTriggerEvidence {
  trigger: FiscalHomologationOperationalTrigger | null;
  satisfied: boolean;
  authority:
    | 'canonical_payment_projection'
    | 'not_implemented_fail_closed'
    | 'homologation_policy_required';
  payment: FiscalCanonicalPaymentEvidence | null;
}

export interface FiscalHomologationPreflightSimulationResult {
  schemaVersion: 3;
  mode: 'simulation_only';
  preflightStatus: 'blocked' | 'ready_for_homologation';
  storeId: string;
  orderId: string;
  sourceChannel: CommerceChannel;
  simulatedAt: string;
  orderScope: FiscalHomologationOperationScope;
  issuerIdentity: FiscalHomologationIssuerIdentityEvidence;
  policy: FiscalHomologationPolicyEvidence;
  triggerEvidence: FiscalOperationalTriggerEvidence;
  productPreparation: FiscalItemPreparation[];
  blockingReasons: FiscalHomologationPreflightBlockingReason[];
  requiredInputs: FiscalHomologationPreflightRequiredInput[];
  execution: {
    fiscalTrigger: FiscalHomologationOperationalTrigger | null;
    documentFamily: FiscalHomologationDocumentFamily | null;
    emissionAuthority: 'none_homologation_only';
    providerCallAllowed: false;
    sefazCallAllowed: false;
  };
  artifact: {
    kind: 'fiscal_preflight_simulation';
    authoritativeDocument: false;
  };
  authority: 'kyrub_homologation_preflight_without_emission_authority';
}

const requiredIdentifier = (value: string, code: string): string => {
  const normalized = typeof value === 'string' ? value.trim() : '';
  if (!normalized) throw new Error(code);
  return normalized.slice(0, 240);
};

const requiredIsoTimestamp = (value: string): string => {
  const normalized = typeof value === 'string' ? value.trim() : '';
  const timestamp = Date.parse(normalized);
  if (!normalized || !Number.isFinite(timestamp)) {
    throw new Error('FISCAL_HOMOLOGATION_PREFLIGHT_TIMESTAMP_INVALID');
  }
  return new Date(timestamp).toISOString();
};

const unique = <T extends string>(values: T[]): T[] => Array.from(new Set(values));

const normalizedItems = (items: FiscalItemPreparation[]): FiscalItemPreparation[] =>
  items.map(item => ({
    productId: typeof item.productId === 'string' ? item.productId.trim().slice(0, 240) : '',
    kind: item.kind,
    fiscalProfileReady: item.fiscalProfileReady === true,
  }));

export const simulateFiscalHomologationPreflight = (input: {
  storeId: string;
  orderId: string;
  sourceChannel: CommerceChannel;
  simulatedAt: string;
  orderScope: FiscalHomologationOperationScope;
  issuerIdentity: FiscalHomologationIssuerIdentityEvidence;
  policy: FiscalHomologationPolicyEvidence;
  triggerEvidence: FiscalOperationalTriggerEvidence;
  items: FiscalItemPreparation[];
}): FiscalHomologationPreflightSimulationResult => {
  const storeId = requiredIdentifier(input.storeId, 'FISCAL_HOMOLOGATION_PREFLIGHT_STORE_REQUIRED');
  const orderId = requiredIdentifier(input.orderId, 'FISCAL_HOMOLOGATION_PREFLIGHT_ORDER_REQUIRED');
  const simulatedAt = requiredIsoTimestamp(input.simulatedAt);
  const simulatedAtMs = Date.parse(simulatedAt);
  const items = normalizedItems(input.items);
  const blockingReasons: FiscalHomologationPreflightBlockingReason[] = [];
  const requiredInputs: FiscalHomologationPreflightRequiredInput[] = [];

  const approvedPolicy =
    input.policy.status === 'approved' &&
    Boolean(input.policy.policyId) &&
    typeof input.policy.version === 'number' &&
    Boolean(input.policy.policyReference) &&
    Boolean(input.policy.effectiveFrom) &&
    Boolean(input.policy.operationScope) &&
    Boolean(input.policy.documentFamily) &&
    Boolean(input.policy.operationalTrigger);

  let policyApplicable = approvedPolicy;
  if (!approvedPolicy) {
    blockingReasons.push('homologation_policy_required');
    requiredInputs.push('approved_homologation_policy');
    policyApplicable = false;
  } else {
    const effectiveAt = Date.parse(input.policy.effectiveFrom as string);
    if (!Number.isFinite(effectiveAt) || effectiveAt > simulatedAtMs) {
      blockingReasons.push('homologation_policy_not_effective');
      requiredInputs.push('effective_homologation_policy');
      policyApplicable = false;
    }
    if (input.policy.operationScope !== input.orderScope) {
      blockingReasons.push('homologation_policy_scope_mismatch');
      requiredInputs.push('matching_operation_scope');
      policyApplicable = false;
    }
  }

  if (
    input.issuerIdentity.status !== 'ready' ||
    input.issuerIdentity.environment !== 'sandbox'
  ) {
    blockingReasons.push('fiscal_issuer_identity_required');
    requiredInputs.push('fiscal_issuer_identity');
  }

  if (items.some(item => !item.fiscalProfileReady)) {
    blockingReasons.push('product_fiscal_preparation_incomplete');
    requiredInputs.push('product_fiscal_preparation');
  }

  if (
    approvedPolicy &&
    (input.triggerEvidence.trigger !== input.policy.operationalTrigger ||
      input.triggerEvidence.satisfied !== true)
  ) {
    blockingReasons.push('operational_trigger_not_satisfied');
    requiredInputs.push('authoritative_operational_trigger');
  }

  const blockers = unique(blockingReasons);
  const executablePolicy = policyApplicable
    ? input.policy
    : null;

  return {
    schemaVersion: 3,
    mode: 'simulation_only',
    preflightStatus: blockers.length === 0 ? 'ready_for_homologation' : 'blocked',
    storeId,
    orderId,
    sourceChannel: input.sourceChannel,
    simulatedAt,
    orderScope: input.orderScope,
    issuerIdentity: input.issuerIdentity,
    policy: input.policy,
    triggerEvidence: input.triggerEvidence,
    productPreparation: items,
    blockingReasons: blockers,
    requiredInputs: unique(requiredInputs),
    execution: {
      fiscalTrigger: executablePolicy?.operationalTrigger ?? null,
      documentFamily: executablePolicy?.documentFamily ?? null,
      emissionAuthority: 'none_homologation_only',
      providerCallAllowed: false,
      sefazCallAllowed: false,
    },
    artifact: {
      kind: 'fiscal_preflight_simulation',
      authoritativeDocument: false,
    },
    authority: 'kyrub_homologation_preflight_without_emission_authority',
  };
};
