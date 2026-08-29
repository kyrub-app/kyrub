import type { EconomicObligation } from './economicObligations.js';
import type { EconomicSettlementRecord } from './economicSettlements.js';

export const ECONOMIC_RECONCILIATION_SCHEMA_VERSION = 1 as const;
export const ECONOMIC_RECONCILIATION_CURRENCY = 'BRL' as const;
export const ECONOMIC_RECONCILIATION_AUTHORITY =
  'obligation_settlement_match' as const;

export type EconomicReconciliationOutcome = 'matched' | 'discrepancy';

export type EconomicReconciliationDiscrepancy =
  | 'obligation_not_settled'
  | 'store_mismatch'
  | 'obligation_reference_mismatch'
  | 'amount_mismatch'
  | 'currency_mismatch'
  | 'beneficiary_mismatch'
  | 'settled_at_mismatch';

export interface EconomicReconciliationRecord {
  schemaVersion: typeof ECONOMIC_RECONCILIATION_SCHEMA_VERSION;
  id: string;
  storeId: string;
  obligationId: string;
  settlementId: string;
  paymentId: string;
  orderId: string;
  beneficiaryType: EconomicObligation['beneficiaryType'];
  beneficiaryPrincipalId: string;
  currency: typeof ECONOMIC_RECONCILIATION_CURRENCY;
  expectedMinor: number;
  settledMinor: number;
  differenceMinor: number;
  outcome: EconomicReconciliationOutcome;
  discrepancies: EconomicReconciliationDiscrepancy[];
  provider: string;
  providerSettlementId: string;
  settlementAuthority: EconomicSettlementRecord['authority'];
  settlementOccurredAt: string;
  settlementObservedAt: string;
  reconciledAt: string;
  authority: typeof ECONOMIC_RECONCILIATION_AUTHORITY;
}

const clean = (value: unknown): string =>
  typeof value === 'string' ? value.trim() : '';

const validIso = (value: string): boolean =>
  Boolean(value) && Number.isFinite(Date.parse(value));

const validIdentityPart = (value: string): boolean =>
  Boolean(value) && value.length <= 180 && !value.includes('/');

const positiveMinor = (value: number, label: string): number => {
  if (!Number.isSafeInteger(value) || value <= 0) {
    throw new Error(`ECONOMIC_RECONCILIATION_${label}_INVALID`);
  }
  return value;
};

export const buildEconomicReconciliationRecordId = (input: {
  provider: string;
  providerSettlementId: string;
}): string => {
  const provider = clean(input.provider);
  const providerSettlementId = clean(input.providerSettlementId);
  if (!validIdentityPart(provider) || !validIdentityPart(providerSettlementId)) {
    throw new Error('ECONOMIC_RECONCILIATION_IDENTITY_INVALID');
  }
  const id = `reconciliation:${provider}:${providerSettlementId}`;
  if (id.length > 240) {
    throw new Error('ECONOMIC_RECONCILIATION_IDENTITY_INVALID');
  }
  return id;
};

export const economicReconciliationPath = (
  storeIdInput: string,
  reconciliationIdInput: string
): string => {
  const storeId = clean(storeIdInput);
  const reconciliationId = clean(reconciliationIdInput);
  if (
    !validIdentityPart(storeId) ||
    !reconciliationId ||
    reconciliationId.length > 240 ||
    reconciliationId === '.' ||
    reconciliationId === '..'
  ) {
    throw new Error('ECONOMIC_RECONCILIATION_PATH_INVALID');
  }
  return `stores/${storeId}/economicReconciliations/${encodeURIComponent(reconciliationId)}`;
};

export const buildEconomicReconciliationRecord = (input: {
  obligation: EconomicObligation;
  settlement: EconomicSettlementRecord;
  reconciledAt: string;
}): EconomicReconciliationRecord => {
  const { obligation, settlement } = input;
  const reconciledAt = clean(input.reconciledAt);
  const expectedMinor = positiveMinor(obligation.amountMinor, 'EXPECTED_AMOUNT');
  const settledMinor = positiveMinor(settlement.amountMinor, 'SETTLED_AMOUNT');

  if (
    !clean(obligation.id) ||
    !clean(obligation.storeId) ||
    !clean(obligation.paymentId) ||
    !clean(obligation.orderId) ||
    !clean(obligation.beneficiaryPrincipalId) ||
    !clean(settlement.id) ||
    !clean(settlement.storeId) ||
    !clean(settlement.obligationId) ||
    !validIdentityPart(clean(settlement.provider)) ||
    !validIdentityPart(clean(settlement.providerSettlementId))
  ) {
    throw new Error('ECONOMIC_RECONCILIATION_FACT_IDENTITY_INVALID');
  }
  if (
    !validIso(clean(obligation.createdAt)) ||
    !validIso(clean(settlement.occurredAt)) ||
    !validIso(clean(settlement.observedAt)) ||
    !validIso(reconciledAt)
  ) {
    throw new Error('ECONOMIC_RECONCILIATION_TIMESTAMP_INVALID');
  }
  if (Date.parse(reconciledAt) < Date.parse(settlement.observedAt)) {
    throw new Error('ECONOMIC_RECONCILIATION_BEFORE_OBSERVATION');
  }
  if (
    settlement.authority !== 'provider_webhook' &&
    settlement.authority !== 'provider_statement'
  ) {
    throw new Error('ECONOMIC_RECONCILIATION_SETTLEMENT_AUTHORITY_INVALID');
  }

  const discrepancies: EconomicReconciliationDiscrepancy[] = [];
  if (obligation.status !== 'settled') {
    discrepancies.push('obligation_not_settled');
  }
  if (obligation.storeId !== settlement.storeId) {
    discrepancies.push('store_mismatch');
  }
  if (obligation.id !== settlement.obligationId) {
    discrepancies.push('obligation_reference_mismatch');
  }
  if (expectedMinor !== settledMinor) {
    discrepancies.push('amount_mismatch');
  }
  if (
    obligation.currency !== ECONOMIC_RECONCILIATION_CURRENCY ||
    settlement.currency !== ECONOMIC_RECONCILIATION_CURRENCY ||
    obligation.currency !== settlement.currency
  ) {
    discrepancies.push('currency_mismatch');
  }
  if (
    obligation.beneficiaryType !== settlement.beneficiaryType ||
    obligation.beneficiaryPrincipalId !== settlement.beneficiaryPrincipalId
  ) {
    discrepancies.push('beneficiary_mismatch');
  }
  if (
    !validIso(clean(obligation.settledAt)) ||
    obligation.settledAt !== settlement.occurredAt
  ) {
    discrepancies.push('settled_at_mismatch');
  }

  const differenceMinor = settledMinor - expectedMinor;
  if (!Number.isSafeInteger(differenceMinor)) {
    throw new Error('ECONOMIC_RECONCILIATION_DIFFERENCE_OVERFLOW');
  }

  return {
    schemaVersion: ECONOMIC_RECONCILIATION_SCHEMA_VERSION,
    id: buildEconomicReconciliationRecordId({
      provider: settlement.provider,
      providerSettlementId: settlement.providerSettlementId,
    }),
    storeId: obligation.storeId,
    obligationId: obligation.id,
    settlementId: settlement.id,
    paymentId: obligation.paymentId,
    orderId: obligation.orderId,
    beneficiaryType: obligation.beneficiaryType,
    beneficiaryPrincipalId: obligation.beneficiaryPrincipalId,
    currency: ECONOMIC_RECONCILIATION_CURRENCY,
    expectedMinor,
    settledMinor,
    differenceMinor,
    outcome: discrepancies.length === 0 ? 'matched' : 'discrepancy',
    discrepancies,
    provider: settlement.provider,
    providerSettlementId: settlement.providerSettlementId,
    settlementAuthority: settlement.authority,
    settlementOccurredAt: settlement.occurredAt,
    settlementObservedAt: settlement.observedAt,
    reconciledAt,
    authority: ECONOMIC_RECONCILIATION_AUTHORITY,
  };
};

export const deriveEconomicReconciliationSummary = (
  records: EconomicReconciliationRecord[]
) => records.reduce(
  (summary, record) => ({
    currency: ECONOMIC_RECONCILIATION_CURRENCY,
    recordCount: summary.recordCount + 1,
    matchedCount: summary.matchedCount + (record.outcome === 'matched' ? 1 : 0),
    discrepancyCount:
      summary.discrepancyCount + (record.outcome === 'discrepancy' ? 1 : 0),
    expectedMinor: summary.expectedMinor + record.expectedMinor,
    settledMinor: summary.settledMinor + record.settledMinor,
    differenceMinor: summary.differenceMinor + record.differenceMinor,
  }),
  {
    currency: ECONOMIC_RECONCILIATION_CURRENCY,
    recordCount: 0,
    matchedCount: 0,
    discrepancyCount: 0,
    expectedMinor: 0,
    settledMinor: 0,
    differenceMinor: 0,
  }
);
