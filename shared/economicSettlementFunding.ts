import type { EconomicObligation } from './economicObligations.js';

export const ECONOMIC_SETTLEMENT_FUNDING_SCHEMA_VERSION = 1 as const;
export const ECONOMIC_SETTLEMENT_FUNDING_CURRENCY = 'BRL' as const;

export type EconomicSettlementFundingPayer = 'store' | 'kyrub';
export type EconomicSettlementFundingSource =
  | 'store_external_funds'
  | 'kyrub_operating_funds';
export type EconomicSettlementFundingAuthority =
  | 'funding_provider_webhook'
  | 'funding_provider_statement';

export interface EconomicSettlementFundingEvidenceInput {
  payer: EconomicSettlementFundingPayer;
  payerPrincipalId: string;
  source: EconomicSettlementFundingSource;
  fundingReferenceId: string;
  amountMinor: number;
  currency: typeof ECONOMIC_SETTLEMENT_FUNDING_CURRENCY;
  occurredAt: string;
  observedAt: string;
  authority: EconomicSettlementFundingAuthority;
}

export interface EconomicSettlementFundingRecord {
  schemaVersion: typeof ECONOMIC_SETTLEMENT_FUNDING_SCHEMA_VERSION;
  id: string;
  storeId: string;
  obligationId: string;
  sourceAuthority: 'delivery_paid_waiting';
  payer: EconomicSettlementFundingPayer;
  payerPrincipalId: string;
  source: EconomicSettlementFundingSource;
  fundingReferenceId: string;
  amountMinor: number;
  currency: typeof ECONOMIC_SETTLEMENT_FUNDING_CURRENCY;
  occurredAt: string;
  observedAt: string;
  authority: EconomicSettlementFundingAuthority;
}

export interface EconomicSettlementFundingRequirement {
  obligationId: string;
  status: 'evidence_required';
  payer: EconomicSettlementFundingPayer;
  payerPrincipalId: string;
  amountMinor: number;
  currency: typeof ECONOMIC_SETTLEMENT_FUNDING_CURRENCY;
}

type PaidWaitingFundingAwareObligation = EconomicObligation & {
  payer?: unknown;
  payerPrincipalId?: unknown;
};

const clean = (value: unknown): string =>
  typeof value === 'string' ? value.trim() : '';

const validIdentity = (value: string): boolean =>
  Boolean(value) && value.length <= 180 && !value.includes('/');

const validIso = (value: string): boolean =>
  Boolean(value) && Number.isFinite(Date.parse(value));

const positiveMinor = (value: number): number => {
  if (!Number.isSafeInteger(value) || value <= 0) {
    throw new Error('ECONOMIC_SETTLEMENT_FUNDING_AMOUNT_INVALID');
  }
  return value;
};

const parsePaidWaitingPayer = (
  obligation: PaidWaitingFundingAwareObligation
): { payer: EconomicSettlementFundingPayer; payerPrincipalId: string } => {
  if (obligation.sourceAuthority !== 'delivery_paid_waiting') {
    throw new Error('ECONOMIC_SETTLEMENT_FUNDING_NOT_REQUIRED');
  }
  const payer = obligation.payer;
  const payerPrincipalId = clean(obligation.payerPrincipalId);
  if (payer !== 'store' && payer !== 'kyrub') {
    throw new Error('ECONOMIC_SETTLEMENT_FUNDING_PAYER_INVALID');
  }
  const expectedPrincipalId =
    payer === 'store' ? `store:${obligation.storeId}` : 'kyrub:platform';
  if (payerPrincipalId !== expectedPrincipalId) {
    throw new Error('ECONOMIC_SETTLEMENT_FUNDING_PAYER_INVALID');
  }
  return { payer, payerPrincipalId };
};

export const deriveEconomicSettlementFundingRequirement = (
  obligation: EconomicObligation
): EconomicSettlementFundingRequirement | null => {
  if (obligation.sourceAuthority !== 'delivery_paid_waiting') return null;
  if (
    obligation.status !== 'eligible' ||
    obligation.currency !== ECONOMIC_SETTLEMENT_FUNDING_CURRENCY ||
    !validIdentity(clean(obligation.id)) ||
    !validIdentity(clean(obligation.storeId)) ||
    !validIdentity(clean(obligation.beneficiaryPrincipalId)) ||
    !validIso(clean(obligation.createdAt)) ||
    !validIso(clean(obligation.eligibleAt)) ||
    Date.parse(obligation.eligibleAt) < Date.parse(obligation.createdAt) ||
    clean(obligation.paymentId) !== '' ||
    clean(obligation.sourceEconomicEntryId) !== ''
  ) {
    throw new Error('ECONOMIC_SETTLEMENT_FUNDING_OBLIGATION_INVALID');
  }
  const amountMinor = positiveMinor(obligation.amountMinor);
  const { payer, payerPrincipalId } = parsePaidWaitingPayer(
    obligation as PaidWaitingFundingAwareObligation
  );
  return {
    obligationId: obligation.id,
    status: 'evidence_required',
    payer,
    payerPrincipalId,
    amountMinor,
    currency: ECONOMIC_SETTLEMENT_FUNDING_CURRENCY,
  };
};

export const buildEconomicSettlementFundingRecordId = (input: {
  source: EconomicSettlementFundingSource;
  fundingReferenceId: string;
}): string => {
  const fundingReferenceId = clean(input.fundingReferenceId);
  if (!validIdentity(fundingReferenceId)) {
    throw new Error('ECONOMIC_SETTLEMENT_FUNDING_IDENTITY_INVALID');
  }
  if (
    input.source !== 'store_external_funds' &&
    input.source !== 'kyrub_operating_funds'
  ) {
    throw new Error('ECONOMIC_SETTLEMENT_FUNDING_SOURCE_INVALID');
  }
  const id = `settlement-funding:${input.source}:${fundingReferenceId}`;
  if (id.length > 240) {
    throw new Error('ECONOMIC_SETTLEMENT_FUNDING_IDENTITY_INVALID');
  }
  return id;
};

export const buildEconomicSettlementFundingRecord = (input: {
  obligation: EconomicObligation;
  evidence: EconomicSettlementFundingEvidenceInput;
}): EconomicSettlementFundingRecord => {
  const requirement = deriveEconomicSettlementFundingRequirement(input.obligation);
  if (!requirement) {
    throw new Error('ECONOMIC_SETTLEMENT_FUNDING_NOT_REQUIRED');
  }

  const fundingReferenceId = clean(input.evidence.fundingReferenceId);
  const payerPrincipalId = clean(input.evidence.payerPrincipalId);
  const occurredAt = clean(input.evidence.occurredAt);
  const observedAt = clean(input.evidence.observedAt);
  const amountMinor = positiveMinor(input.evidence.amountMinor);

  if (!validIdentity(fundingReferenceId) || !validIdentity(payerPrincipalId)) {
    throw new Error('ECONOMIC_SETTLEMENT_FUNDING_IDENTITY_INVALID');
  }
  if (
    input.evidence.payer !== requirement.payer ||
    payerPrincipalId !== requirement.payerPrincipalId
  ) {
    throw new Error('ECONOMIC_SETTLEMENT_FUNDING_PAYER_MISMATCH');
  }
  const expectedSource: EconomicSettlementFundingSource =
    requirement.payer === 'store'
      ? 'store_external_funds'
      : 'kyrub_operating_funds';
  if (input.evidence.source !== expectedSource) {
    throw new Error('ECONOMIC_SETTLEMENT_FUNDING_SOURCE_MISMATCH');
  }
  if (
    input.evidence.currency !== ECONOMIC_SETTLEMENT_FUNDING_CURRENCY ||
    amountMinor !== requirement.amountMinor
  ) {
    throw new Error('ECONOMIC_SETTLEMENT_FUNDING_AMOUNT_MISMATCH');
  }
  if (!validIso(occurredAt) || !validIso(observedAt)) {
    throw new Error('ECONOMIC_SETTLEMENT_FUNDING_TIMESTAMP_INVALID');
  }
  if (Date.parse(occurredAt) < Date.parse(input.obligation.eligibleAt)) {
    throw new Error('ECONOMIC_SETTLEMENT_FUNDING_BEFORE_ELIGIBILITY');
  }
  if (Date.parse(observedAt) < Date.parse(occurredAt)) {
    throw new Error('ECONOMIC_SETTLEMENT_FUNDING_OBSERVED_BEFORE_OCCURRED');
  }
  if (
    input.evidence.authority !== 'funding_provider_webhook' &&
    input.evidence.authority !== 'funding_provider_statement'
  ) {
    throw new Error('ECONOMIC_SETTLEMENT_FUNDING_AUTHORITY_INVALID');
  }

  return {
    schemaVersion: ECONOMIC_SETTLEMENT_FUNDING_SCHEMA_VERSION,
    id: buildEconomicSettlementFundingRecordId({
      source: input.evidence.source,
      fundingReferenceId,
    }),
    storeId: input.obligation.storeId,
    obligationId: input.obligation.id,
    sourceAuthority: 'delivery_paid_waiting',
    payer: requirement.payer,
    payerPrincipalId: requirement.payerPrincipalId,
    source: input.evidence.source,
    fundingReferenceId,
    amountMinor,
    currency: ECONOMIC_SETTLEMENT_FUNDING_CURRENCY,
    occurredAt,
    observedAt,
    authority: input.evidence.authority,
  };
};
