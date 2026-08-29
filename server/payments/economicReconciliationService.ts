import { adminDb } from '../firebaseAdmin.js';
import {
  ECONOMIC_OBLIGATION_SCHEMA_VERSION,
  economicObligationPath,
  type EconomicObligation,
} from '../../shared/economicObligations.js';
import {
  ECONOMIC_SETTLEMENT_SCHEMA_VERSION,
  buildEconomicSettlementRecordId,
  economicSettlementPath,
  type EconomicSettlementRecord,
} from '../../shared/economicSettlements.js';
import {
  ECONOMIC_RECONCILIATION_AUTHORITY,
  ECONOMIC_RECONCILIATION_SCHEMA_VERSION,
  buildEconomicReconciliationRecord,
  buildEconomicReconciliationRecordId,
  economicReconciliationPath,
  type EconomicReconciliationRecord,
} from '../../shared/economicReconciliation.js';

export interface RecordEconomicReconciliationResult {
  duplicate: boolean;
  reconciliation: EconomicReconciliationRecord;
}

const clean = (value: unknown): string =>
  typeof value === 'string' ? value.trim() : '';

const validIso = (value: unknown): value is string =>
  typeof value === 'string' && Boolean(value) && Number.isFinite(Date.parse(value));

const parseObligationForReconciliation = (
  value: unknown,
  expectedStoreId: string,
  expectedObligationId: string
): EconomicObligation => {
  const obligation = value as Partial<EconomicObligation> & { currency?: unknown };
  const statusValid =
    obligation.status === 'pending' ||
    obligation.status === 'eligible' ||
    obligation.status === 'settled' ||
    obligation.status === 'reversed';
  const beneficiaryValid =
    obligation.beneficiaryType === 'store' ||
    obligation.beneficiaryType === 'courier';

  if (
    obligation.schemaVersion !== ECONOMIC_OBLIGATION_SCHEMA_VERSION ||
    obligation.id !== expectedObligationId ||
    obligation.storeId !== expectedStoreId ||
    !statusValid ||
    typeof obligation.currency !== 'string' ||
    !Number.isSafeInteger(obligation.amountMinor) ||
    Number(obligation.amountMinor) <= 0 ||
    !beneficiaryValid ||
    !clean(obligation.beneficiaryPrincipalId) ||
    !clean(obligation.paymentId) ||
    !clean(obligation.orderId) ||
    !clean(obligation.sourceEconomicEntryId) ||
    obligation.sourceAuthority !== 'economic_allocation_snapshot' ||
    !validIso(obligation.createdAt) ||
    typeof obligation.eligibleAt !== 'string' ||
    typeof obligation.settledAt !== 'string' ||
    typeof obligation.reversedAt !== 'string'
  ) {
    throw new Error('ECONOMIC_RECONCILIATION_STORED_OBLIGATION_INVALID');
  }

  return obligation as EconomicObligation;
};

const parseSettlementForReconciliation = (
  value: unknown,
  expectedSettlementId: string
): EconomicSettlementRecord => {
  const settlement = value as Partial<EconomicSettlementRecord> & { currency?: unknown };
  const beneficiaryValid =
    settlement.beneficiaryType === 'store' ||
    settlement.beneficiaryType === 'courier';
  const authorityValid =
    settlement.authority === 'provider_webhook' ||
    settlement.authority === 'provider_statement';

  if (
    settlement.schemaVersion !== ECONOMIC_SETTLEMENT_SCHEMA_VERSION ||
    settlement.id !== expectedSettlementId ||
    !clean(settlement.storeId) ||
    !clean(settlement.obligationId) ||
    !beneficiaryValid ||
    !clean(settlement.beneficiaryPrincipalId) ||
    typeof settlement.currency !== 'string' ||
    !Number.isSafeInteger(settlement.amountMinor) ||
    Number(settlement.amountMinor) <= 0 ||
    !clean(settlement.provider) ||
    !clean(settlement.providerSettlementId) ||
    !authorityValid ||
    !validIso(settlement.occurredAt) ||
    !validIso(settlement.observedAt) ||
    Date.parse(settlement.observedAt) < Date.parse(settlement.occurredAt)
  ) {
    throw new Error('ECONOMIC_RECONCILIATION_STORED_SETTLEMENT_INVALID');
  }

  const deterministicSettlementId = buildEconomicSettlementRecordId({
    provider: settlement.provider,
    providerSettlementId: settlement.providerSettlementId,
  });
  if (deterministicSettlementId !== expectedSettlementId) {
    throw new Error('ECONOMIC_RECONCILIATION_SETTLEMENT_ID_CONFLICT');
  }

  return settlement as EconomicSettlementRecord;
};

const parseStoredReconciliation = (
  value: unknown,
  expectedStoreId: string,
  expectedReconciliationId: string
): EconomicReconciliationRecord => {
  const record = value as Partial<EconomicReconciliationRecord>;
  const outcomeValid = record.outcome === 'matched' || record.outcome === 'discrepancy';
  if (
    record.schemaVersion !== ECONOMIC_RECONCILIATION_SCHEMA_VERSION ||
    record.id !== expectedReconciliationId ||
    record.storeId !== expectedStoreId ||
    !clean(record.obligationId) ||
    !clean(record.settlementId) ||
    !clean(record.paymentId) ||
    !clean(record.orderId) ||
    (record.beneficiaryType !== 'store' && record.beneficiaryType !== 'courier') ||
    !clean(record.beneficiaryPrincipalId) ||
    record.currency !== 'BRL' ||
    !Number.isSafeInteger(record.expectedMinor) ||
    Number(record.expectedMinor) <= 0 ||
    !Number.isSafeInteger(record.settledMinor) ||
    Number(record.settledMinor) <= 0 ||
    !Number.isSafeInteger(record.differenceMinor) ||
    !outcomeValid ||
    !Array.isArray(record.discrepancies) ||
    !clean(record.provider) ||
    !clean(record.providerSettlementId) ||
    (record.settlementAuthority !== 'provider_webhook' &&
      record.settlementAuthority !== 'provider_statement') ||
    !validIso(record.settlementOccurredAt) ||
    !validIso(record.settlementObservedAt) ||
    !validIso(record.reconciledAt) ||
    record.authority !== ECONOMIC_RECONCILIATION_AUTHORITY
  ) {
    throw new Error('ECONOMIC_RECONCILIATION_STORED_RECORD_INVALID');
  }
  return record as EconomicReconciliationRecord;
};

const assertReconciliationEquivalent = (
  existing: EconomicReconciliationRecord,
  expected: EconomicReconciliationRecord
): void => {
  const scalarKeys: Array<keyof EconomicReconciliationRecord> = [
    'schemaVersion',
    'id',
    'storeId',
    'obligationId',
    'settlementId',
    'paymentId',
    'orderId',
    'beneficiaryType',
    'beneficiaryPrincipalId',
    'currency',
    'expectedMinor',
    'settledMinor',
    'differenceMinor',
    'outcome',
    'provider',
    'providerSettlementId',
    'settlementAuthority',
    'settlementOccurredAt',
    'settlementObservedAt',
    'reconciledAt',
    'authority',
  ];
  for (const key of scalarKeys) {
    if (existing[key] !== expected[key]) {
      throw new Error('ECONOMIC_RECONCILIATION_CONFLICT');
    }
  }
  if (
    existing.discrepancies.length !== expected.discrepancies.length ||
    existing.discrepancies.some(
      (discrepancy, index) => discrepancy !== expected.discrepancies[index]
    )
  ) {
    throw new Error('ECONOMIC_RECONCILIATION_CONFLICT');
  }
};

export const recordEconomicReconciliation = async (input: {
  storeId: string;
  obligationId: string;
  settlementId: string;
  reconciledAt: string;
}): Promise<RecordEconomicReconciliationResult> => {
  const storeId = clean(input.storeId);
  const obligationId = clean(input.obligationId);
  const settlementId = clean(input.settlementId);
  const reconciledAt = clean(input.reconciledAt);
  if (!storeId || !obligationId || !settlementId || !validIso(reconciledAt)) {
    throw new Error('ECONOMIC_RECONCILIATION_TARGET_REQUIRED');
  }

  const obligationRef = adminDb.doc(economicObligationPath(storeId, obligationId));
  const settlementRef = adminDb.doc(economicSettlementPath(storeId, settlementId));

  return adminDb.runTransaction(async transaction => {
    const [obligationSnapshot, settlementSnapshot] = await Promise.all([
      transaction.get(obligationRef),
      transaction.get(settlementRef),
    ]);
    if (!obligationSnapshot.exists) {
      throw new Error('ECONOMIC_RECONCILIATION_OBLIGATION_NOT_FOUND');
    }
    if (!settlementSnapshot.exists) {
      throw new Error('ECONOMIC_RECONCILIATION_SETTLEMENT_NOT_FOUND');
    }

    const obligation = parseObligationForReconciliation(
      obligationSnapshot.data(),
      storeId,
      obligationId
    );
    const settlement = parseSettlementForReconciliation(
      settlementSnapshot.data(),
      settlementId
    );
    const reconciliation = buildEconomicReconciliationRecord({
      obligation,
      settlement,
      reconciledAt,
    });
    const expectedReconciliationId = buildEconomicReconciliationRecordId({
      provider: settlement.provider,
      providerSettlementId: settlement.providerSettlementId,
    });
    if (reconciliation.id !== expectedReconciliationId) {
      throw new Error('ECONOMIC_RECONCILIATION_ID_CONFLICT');
    }

    const reconciliationRef = adminDb.doc(
      economicReconciliationPath(storeId, reconciliation.id)
    );
    const reconciliationSnapshot = await transaction.get(reconciliationRef);
    if (reconciliationSnapshot.exists) {
      const existing = parseStoredReconciliation(
        reconciliationSnapshot.data(),
        storeId,
        reconciliation.id
      );
      assertReconciliationEquivalent(existing, reconciliation);
      return { duplicate: true, reconciliation: existing };
    }

    transaction.set(reconciliationRef, reconciliation);
    return { duplicate: false, reconciliation };
  });
};
