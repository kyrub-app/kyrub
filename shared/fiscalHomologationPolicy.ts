export type FiscalHomologationDocumentFamily = 'nfe' | 'nfce' | 'nfse';

export type FiscalHomologationOperationalTrigger =
  | 'payment_confirmed'
  | 'fulfillment_confirmed'
  | 'service_completed';

export type FiscalHomologationOperationScope = 'goods' | 'service' | 'mixed';

export type FiscalHomologationPolicyStatus =
  | 'draft'
  | 'approved_for_homologation';

export type FiscalHomologationPolicyMissingInput =
  | 'policy_reference'
  | 'effective_from'
  | 'operation_scope'
  | 'document_family'
  | 'operational_trigger';

export interface FiscalHomologationPolicyDraftInput {
  policyId?: string;
  storeId?: string;
  version?: number;
  status?: FiscalHomologationPolicyStatus;
  policyReference?: string;
  effectiveFrom?: string;
  operationScope?: FiscalHomologationOperationScope | null;
  documentFamily?: FiscalHomologationDocumentFamily | null;
  operationalTrigger?: FiscalHomologationOperationalTrigger | null;
}

export interface FiscalHomologationPolicyDraft {
  schemaVersion: 1;
  policyId: string;
  storeId: string;
  version: number;
  status: FiscalHomologationPolicyStatus;
  policyReference: string;
  effectiveFrom: string | null;
  operationScope: FiscalHomologationOperationScope | null;
  documentFamily: FiscalHomologationDocumentFamily | null;
  operationalTrigger: FiscalHomologationOperationalTrigger | null;
  environment: 'sandbox';
  authority: 'explicit_accounting_policy_for_homologation';
  emissionAuthority: 'none_homologation_only';
  providerCallAllowed: false;
  sefazCallAllowed: false;
}

export interface FiscalHomologationPolicyResolution {
  schemaVersion: 1;
  resolutionStatus: 'draft_incomplete' | 'ready_for_homologation';
  policy: FiscalHomologationPolicyDraft;
  missingInputs: FiscalHomologationPolicyMissingInput[];
  executableInProduction: false;
  emissionAuthority: 'none_homologation_only';
  providerCallAllowed: false;
  sefazCallAllowed: false;
  authority: 'structural_homologation_policy_validation_only';
}

const POLICY_ID_PATTERN = /^[a-zA-Z0-9:_-]{1,160}$/;
const STORE_ID_PATTERN = /^[a-zA-Z0-9:_-]{1,160}$/;

const clean = (value: unknown, maxLength: number): string =>
  typeof value === 'string' ? value.trim().slice(0, maxLength) : '';

const normalizeVersion = (value: unknown): number =>
  typeof value === 'number' && Number.isInteger(value) && value > 0 && value <= 1_000_000
    ? value
    : 1;

const normalizeTimestamp = (value: unknown): string | null => {
  if (typeof value !== 'string' || !value.trim()) return null;
  const timestamp = Date.parse(value);
  return Number.isFinite(timestamp) ? new Date(timestamp).toISOString() : null;
};

const normalizeScope = (value: unknown): FiscalHomologationOperationScope | null =>
  value === 'goods' || value === 'service' || value === 'mixed'
    ? value
    : null;

const normalizeDocumentFamily = (value: unknown): FiscalHomologationDocumentFamily | null =>
  value === 'nfe' || value === 'nfce' || value === 'nfse'
    ? value
    : null;

const normalizeOperationalTrigger = (
  value: unknown
): FiscalHomologationOperationalTrigger | null =>
  value === 'payment_confirmed' ||
  value === 'fulfillment_confirmed' ||
  value === 'service_completed'
    ? value
    : null;

export const parseFiscalHomologationPolicyDraft = (
  input: FiscalHomologationPolicyDraftInput
): FiscalHomologationPolicyDraft => {
  const policyId = clean(input.policyId, 160);
  const storeId = clean(input.storeId, 160);
  if (!POLICY_ID_PATTERN.test(policyId)) {
    throw new Error('FISCAL_HOMOLOGATION_POLICY_ID_INVALID');
  }
  if (!STORE_ID_PATTERN.test(storeId)) {
    throw new Error('FISCAL_HOMOLOGATION_POLICY_STORE_INVALID');
  }

  return {
    schemaVersion: 1,
    policyId,
    storeId,
    version: normalizeVersion(input.version),
    status: input.status === 'approved_for_homologation'
      ? 'approved_for_homologation'
      : 'draft',
    policyReference: clean(input.policyReference, 160),
    effectiveFrom: normalizeTimestamp(input.effectiveFrom),
    operationScope: normalizeScope(input.operationScope),
    documentFamily: normalizeDocumentFamily(input.documentFamily),
    operationalTrigger: normalizeOperationalTrigger(input.operationalTrigger),
    environment: 'sandbox',
    authority: 'explicit_accounting_policy_for_homologation',
    emissionAuthority: 'none_homologation_only',
    providerCallAllowed: false,
    sefazCallAllowed: false,
  };
};

export const getFiscalHomologationPolicyMissingInputs = (
  policy: FiscalHomologationPolicyDraft
): FiscalHomologationPolicyMissingInput[] => {
  const missing: FiscalHomologationPolicyMissingInput[] = [];
  if (!policy.policyReference) missing.push('policy_reference');
  if (!policy.effectiveFrom) missing.push('effective_from');
  if (!policy.operationScope) missing.push('operation_scope');
  if (!policy.documentFamily) missing.push('document_family');
  if (!policy.operationalTrigger) missing.push('operational_trigger');
  return missing;
};

export const resolveFiscalHomologationPolicy = (
  input: FiscalHomologationPolicyDraftInput
): FiscalHomologationPolicyResolution => {
  const policy = parseFiscalHomologationPolicyDraft(input);
  const missingInputs = getFiscalHomologationPolicyMissingInputs(policy);
  const ready =
    policy.status === 'approved_for_homologation' &&
    missingInputs.length === 0;

  return {
    schemaVersion: 1,
    resolutionStatus: ready ? 'ready_for_homologation' : 'draft_incomplete',
    policy,
    missingInputs,
    executableInProduction: false,
    emissionAuthority: 'none_homologation_only',
    providerCallAllowed: false,
    sefazCallAllowed: false,
    authority: 'structural_homologation_policy_validation_only',
  };
};

export const validateFiscalHomologationPolicyForApproval = (
  input: FiscalHomologationPolicyDraftInput
): FiscalHomologationPolicyResolution => {
  const resolution = resolveFiscalHomologationPolicy({
    ...input,
    status: 'approved_for_homologation',
  });
  if (resolution.missingInputs.length > 0) {
    throw new Error(
      `FISCAL_HOMOLOGATION_POLICY_INCOMPLETE:${resolution.missingInputs.join(',')}`
    );
  }
  return resolution;
};
