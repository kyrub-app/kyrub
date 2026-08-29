import type {
  EconomicObligation,
  EconomicObligationBeneficiaryType,
} from './economicObligations.js';

export const ECONOMIC_SETTLEMENT_SCHEMA_VERSION = 1 as const;
export const ECONOMIC_SETTLEMENT_CURRENCY = 'BRL' as const;

export type EconomicSettlementAuthority =
  | 'provider_webhook'
  | 'provider_statement';

export interface EconomicSettlementEvidenceInput {
  provider: string;
  providerSettlementId: string;
  amountMinor: number;
  occurredAt: string;
  observedAt: string;
  authority: EconomicSettlementAuthority;
}

export interface EconomicSettlementRecord {
  schemaVersion: typeof ECONOMIC_SETTLEMENT_SCHEMA_VERSION;
  id: string;
  storeId: string;
  obligationId: string;
  beneficiaryType: EconomicObligationBeneficiaryType;
  beneficiaryPrincipalId: string;
  currency: typeof ECONOMIC_SETTLEMENT_CURRENCY;
  amountMinor: number;
  provider: string;
  providerSettlementId: string;
  authority: EconomicSettlementAuthority;
  occurredAt: string;
  observedAt: string;
}

export interface SettlementEvidenceAdapter<ProviderEvidence> {
  readonly provider: string;
  normalizeEvidence(evidence: ProviderEvidence): EconomicSettlementEvidenceInput;
}

const clean = (value: unknown): string =>
  typeof value === 'string' ? value.trim() : '';

const validIso = (value: string): boolean =>
  Boolean(value) && Number.isFinite(Date.parse(value));

const validIdentityPart = (value: string): boolean =>
  Boolean(value) && value.length <= 180 && !value.includes('/');

const positiveMinor = (value: number): number => {
  if (!Number.isSafeInteger(value) || value <= 0) {
    throw new Error('ECONOMIC_SETTLEMENT_AMOUNT_INVALID');
  }
  return value;
};

export const buildEconomicSettlementRecordId = (input: {
  provider: string;
  providerSettlementId: string;
}): string => {
  const provider = clean(input.provider);
  const providerSettlementId = clean(input.providerSettlementId);
  if (!validIdentityPart(provider) || !validIdentityPart(providerSettlementId)) {
    throw new Error('ECONOMIC_SETTLEMENT_IDENTITY_INVALID');
  }
  const id = `settlement:${provider}:${providerSettlementId}`;
  if (id.length > 240) throw new Error('ECONOMIC_SETTLEMENT_IDENTITY_INVALID');
  return id;
};

export const economicSettlementPath = (
  storeIdInput: string,
  settlementIdInput: string
): string => {
  const storeId = clean(storeIdInput);
  const settlementId = clean(settlementIdInput);
  if (!validIdentityPart(storeId) || !settlementId || settlementId.length > 240) {
    throw new Error('ECONOMIC_SETTLEMENT_PATH_INVALID');
  }
  return `stores/${storeId}/economicSettlements/${encodeURIComponent(settlementId)}`;
};

const assertObligationEligibleForSettlement = (
  obligation: EconomicObligation
): void => {
  if (
    obligation.currency !== ECONOMIC_SETTLEMENT_CURRENCY ||
    obligation.amountMinor <= 0 ||
    !Number.isSafeInteger(obligation.amountMinor) ||
    !clean(obligation.id) ||
    !clean(obligation.storeId) ||
    !clean(obligation.beneficiaryPrincipalId)
  ) {
    throw new Error('ECONOMIC_SETTLEMENT_OBLIGATION_INVALID');
  }
  if (obligation.status !== 'eligible') {
    throw new Error(`ECONOMIC_SETTLEMENT_OBLIGATION_NOT_ELIGIBLE:${obligation.status}`);
  }
};

export const buildEconomicSettlementRecord = (input: {
  obligation: EconomicObligation;
  evidence: EconomicSettlementEvidenceInput;
}): EconomicSettlementRecord => {
  const { obligation } = input;
  assertObligationEligibleForSettlement(obligation);

  const provider = clean(input.evidence.provider);
  const providerSettlementId = clean(input.evidence.providerSettlementId);
  const occurredAt = clean(input.evidence.occurredAt);
  const observedAt = clean(input.evidence.observedAt);
  const amountMinor = positiveMinor(input.evidence.amountMinor);

  if (!validIdentityPart(provider) || !validIdentityPart(providerSettlementId)) {
    throw new Error('ECONOMIC_SETTLEMENT_IDENTITY_INVALID');
  }
  if (!validIso(occurredAt) || !validIso(observedAt)) {
    throw new Error('ECONOMIC_SETTLEMENT_TIMESTAMP_INVALID');
  }
  if (Date.parse(observedAt) < Date.parse(occurredAt)) {
    throw new Error('ECONOMIC_SETTLEMENT_OBSERVED_BEFORE_OCCURRED');
  }
  if (amountMinor !== obligation.amountMinor) {
    throw new Error('ECONOMIC_SETTLEMENT_AMOUNT_MISMATCH');
  }
  if (
    input.evidence.authority !== 'provider_webhook' &&
    input.evidence.authority !== 'provider_statement'
  ) {
    throw new Error('ECONOMIC_SETTLEMENT_AUTHORITY_INVALID');
  }

  return {
    schemaVersion: ECONOMIC_SETTLEMENT_SCHEMA_VERSION,
    id: buildEconomicSettlementRecordId({ provider, providerSettlementId }),
    storeId: obligation.storeId,
    obligationId: obligation.id,
    beneficiaryType: obligation.beneficiaryType,
    beneficiaryPrincipalId: obligation.beneficiaryPrincipalId,
    currency: ECONOMIC_SETTLEMENT_CURRENCY,
    amountMinor,
    provider,
    providerSettlementId,
    authority: input.evidence.authority,
    occurredAt,
    observedAt,
  };
};
