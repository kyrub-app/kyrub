import {
  evaluateFiscalEventCandidate,
  type CommerceChannel,
  type FiscalAccountingDecisionEvidenceInput,
  type FiscalEventCandidate,
  type FiscalItemPreparation,
} from './channelAvailabilityFiscalFoundation';

export type FiscalSimulationBlockingReason =
  | 'accounting_decision_required'
  | 'accounting_policy_resolution_required'
  | 'fiscal_issuer_identity_required'
  | 'product_fiscal_preparation_incomplete'
  | 'commercial_confirmation_required';

export type FiscalSimulationRequiredInput =
  | 'accounting_decision'
  | 'executable_accounting_policy'
  | 'fiscal_issuer_identity'
  | 'product_fiscal_preparation'
  | 'commercial_confirmation';

export interface FiscalSimulationIssuerIdentityEvidence {
  status: 'ready' | 'required';
  identifierKind: 'cpf' | 'cnpj' | null;
  environment: 'sandbox' | 'production';
}

export interface FiscalSimulationExecutionBoundary {
  fiscalTrigger: null;
  documentFamily: null;
  emissionAuthority: 'none_until_accounting_policy';
  providerCallAllowed: false;
  sefazCallAllowed: false;
}

export interface FiscalSimulationArtifact {
  kind: 'fiscal_preflight_simulation';
  authoritativeDocument: false;
}

export interface FiscalSimulationResult {
  schemaVersion: 2;
  mode: 'simulation_only';
  simulationStatus: 'blocked';
  storeId: string;
  orderId: string;
  sourceChannel: CommerceChannel;
  simulatedAt: string;
  issuerIdentity: FiscalSimulationIssuerIdentityEvidence;
  candidate: FiscalEventCandidate;
  blockingReasons: FiscalSimulationBlockingReason[];
  requiredInputs: FiscalSimulationRequiredInput[];
  execution: FiscalSimulationExecutionBoundary;
  artifact: FiscalSimulationArtifact;
  authority: 'kyrub_fiscal_preflight_without_emission_authority';
}

const requiredIdentifier = (
  value: string,
  code: 'FISCAL_SIMULATION_STORE_REQUIRED' | 'FISCAL_SIMULATION_ORDER_REQUIRED'
): string => {
  const normalized = typeof value === 'string' ? value.trim() : '';
  if (!normalized) throw new Error(code);
  return normalized.slice(0, 240);
};

const requiredIsoTimestamp = (value: string): string => {
  const normalized = typeof value === 'string' ? value.trim() : '';
  const timestamp = Date.parse(normalized);
  if (!normalized || !Number.isFinite(timestamp)) {
    throw new Error('FISCAL_SIMULATION_TIMESTAMP_INVALID');
  }
  return new Date(timestamp).toISOString();
};

const normalizeItems = (
  items: FiscalItemPreparation[]
): FiscalItemPreparation[] => items.map(item => ({
  productId: typeof item.productId === 'string' ? item.productId.trim().slice(0, 240) : '',
  kind: item.kind,
  fiscalProfileReady: item.fiscalProfileReady === true,
}));

const normalizeIssuerIdentity = (
  value: FiscalSimulationIssuerIdentityEvidence | undefined
): FiscalSimulationIssuerIdentityEvidence => ({
  status: value?.status === 'ready' ? 'ready' : 'required',
  identifierKind:
    value?.identifierKind === 'cpf' || value?.identifierKind === 'cnpj'
      ? value.identifierKind
      : null,
  environment: value?.environment === 'production' ? 'production' : 'sandbox',
});

const unique = <T extends string>(values: T[]): T[] =>
  Array.from(new Set(values));

/**
 * Builds a non-authoritative fiscal preflight snapshot from evidence already
 * known by Kyrub. There is deliberately no executable-policy input here:
 * until a separately verified accounting-policy resolver exists, every result
 * remains blocked and cannot become an emission request.
 */
export const simulateFiscalPreflight = (input: {
  storeId: string;
  orderId: string;
  sourceChannel: CommerceChannel;
  commerciallyConfirmed: boolean;
  issuerIdentity?: FiscalSimulationIssuerIdentityEvidence;
  accountingDecision?: FiscalAccountingDecisionEvidenceInput;
  items: FiscalItemPreparation[];
  simulatedAt: string;
}): FiscalSimulationResult => {
  const storeId = requiredIdentifier(input.storeId, 'FISCAL_SIMULATION_STORE_REQUIRED');
  const orderId = requiredIdentifier(input.orderId, 'FISCAL_SIMULATION_ORDER_REQUIRED');
  const simulatedAt = requiredIsoTimestamp(input.simulatedAt);
  const issuerIdentity = normalizeIssuerIdentity(input.issuerIdentity);
  const candidate = evaluateFiscalEventCandidate({
    storeId,
    orderId,
    sourceChannel: input.sourceChannel,
    commerciallyConfirmed: input.commerciallyConfirmed === true,
    accountingDecision: input.accountingDecision,
    items: normalizeItems(input.items),
  });

  const blockingReasons: FiscalSimulationBlockingReason[] = [candidate.status];
  const requiredInputs: FiscalSimulationRequiredInput[] = [
    candidate.status === 'accounting_decision_required'
      ? 'accounting_decision'
      : 'executable_accounting_policy',
  ];

  if (issuerIdentity.status !== 'ready') {
    blockingReasons.push('fiscal_issuer_identity_required');
    requiredInputs.push('fiscal_issuer_identity');
  }
  if (candidate.missingProductIds.length > 0) {
    blockingReasons.push('product_fiscal_preparation_incomplete');
    requiredInputs.push('product_fiscal_preparation');
  }
  if (candidate.commercialEvidence !== 'confirmed') {
    blockingReasons.push('commercial_confirmation_required');
    requiredInputs.push('commercial_confirmation');
  }

  return {
    schemaVersion: 2,
    mode: 'simulation_only',
    simulationStatus: 'blocked',
    storeId,
    orderId,
    sourceChannel: input.sourceChannel,
    simulatedAt,
    issuerIdentity,
    candidate,
    blockingReasons: unique(blockingReasons),
    requiredInputs: unique(requiredInputs),
    execution: {
      fiscalTrigger: null,
      documentFamily: null,
      emissionAuthority: 'none_until_accounting_policy',
      providerCallAllowed: false,
      sefazCallAllowed: false,
    },
    artifact: {
      kind: 'fiscal_preflight_simulation',
      authoritativeDocument: false,
    },
    authority: 'kyrub_fiscal_preflight_without_emission_authority',
  };
};
