import { adminDb } from '../firebaseAdmin.js';
import {
  ECONOMIC_OBLIGATION_SCHEMA_VERSION,
  economicObligationPath,
  type EconomicObligation,
} from '../../shared/economicObligations.js';
import { settleEconomicObligationFromEvidence } from '../../shared/economicObligationLifecycle.js';
import {
  ECONOMIC_SETTLEMENT_SCHEMA_VERSION,
  buildEconomicSettlementRecord,
  buildEconomicSettlementRecordId,
  economicSettlementPath,
  type EconomicSettlementEvidenceInput,
  type EconomicSettlementRecord,
} from '../../shared/economicSettlements.js';

export interface RecordEconomicSettlementEvidenceResult {
  duplicate: boolean;
  obligation: EconomicObligation;
  settlement: EconomicSettlementRecord;
}

const clean = (value: unknown): string =>
  typeof value === 'string' ? value.trim() : '';

const validIso = (value: unknown): value is string =>
  typeof value === 'string' && Boolean(value) && Number.isFinite(Date.parse(value));

const validLifecycle = (obligation: Partial<EconomicObligation>): boolean => {
  if (obligation.status === 'eligible') {
    return validIso(obligation.eligibleAt) &&
      obligation.settledAt === '' &&
      obligation.reversedAt === '';
  }
  if (obligation.status === 'settled') {
    return validIso(obligation.eligibleAt) &&
      validIso(obligation.settledAt) &&
      obligation.reversedAt === '';
  }
  return false;
};

const parseStoredObligation = (
  value: unknown,
  expectedStoreId: string,
  expectedObligationId: string
): EconomicObligation => {
  const obligation = value as Partial<EconomicObligation>;
  const kindValid =
    (obligation.kind === 'store_receivable' &&
      obligation.beneficiaryType === 'store' &&
      obligation.beneficiaryPrincipalId === `store:${expectedStoreId}` &&
      obligation.fulfillmentId === '') ||
    (obligation.kind === 'courier_payable' &&
      obligation.beneficiaryType === 'courier' &&
      Boolean(clean(obligation.beneficiaryPrincipalId)) &&
      Boolean(clean(obligation.fulfillmentId)));

  if (
    obligation.schemaVersion !== ECONOMIC_OBLIGATION_SCHEMA_VERSION ||
    obligation.id !== expectedObligationId ||
    obligation.storeId !== expectedStoreId ||
    !kindValid ||
    !validLifecycle(obligation) ||
    obligation.currency !== 'BRL' ||
    !Number.isSafeInteger(obligation.amountMinor) ||
    Number(obligation.amountMinor) <= 0 ||
    !clean(obligation.paymentId) ||
    !clean(obligation.orderId) ||
    !clean(obligation.sourceEconomicEntryId) ||
    obligation.sourceAuthority !== 'economic_allocation_snapshot' ||
    !obligation.funding ||
    !Number.isSafeInteger(obligation.funding.customerMinor) ||
    obligation.funding.customerMinor < 0 ||
    !Number.isSafeInteger(obligation.funding.kyrubMinor) ||
    obligation.funding.kyrubMinor < 0 ||
    !Number.isSafeInteger(obligation.funding.partnerMinor) ||
    obligation.funding.partnerMinor < 0 ||
    !Number.isSafeInteger(obligation.funding.storeFundedDiscountMinor) ||
    obligation.funding.storeFundedDiscountMinor < 0 ||
    !validIso(obligation.createdAt)
  ) {
    throw new Error('ECONOMIC_SETTLEMENT_STORED_OBLIGATION_INVALID');
  }
  return obligation as EconomicObligation;
};

const parseStoredSettlement = (
  value: unknown,
  expectedStoreId: string,
  expectedSettlementId: string
): EconomicSettlementRecord => {
  const settlement = value as Partial<EconomicSettlementRecord>;
  if (
    settlement.schemaVersion !== ECONOMIC_SETTLEMENT_SCHEMA_VERSION ||
    settlement.id !== expectedSettlementId ||
    settlement.storeId !== expectedStoreId ||
    !clean(settlement.obligationId) ||
    (settlement.beneficiaryType !== 'store' && settlement.beneficiaryType !== 'courier') ||
    !clean(settlement.beneficiaryPrincipalId) ||
    settlement.currency !== 'BRL' ||
    !Number.isSafeInteger(settlement.amountMinor) ||
    Number(settlement.amountMinor) <= 0 ||
    !clean(settlement.provider) ||
    !clean(settlement.providerSettlementId) ||
    (settlement.authority !== 'provider_webhook' && settlement.authority !== 'provider_statement') ||
    !validIso(settlement.occurredAt) ||
    !validIso(settlement.observedAt) ||
    Date.parse(settlement.observedAt) < Date.parse(settlement.occurredAt)
  ) {
    throw new Error('ECONOMIC_SETTLEMENT_STORED_RECORD_INVALID');
  }
  return settlement as EconomicSettlementRecord;
};

const assertExistingSettlementMatches = (input: {
  existing: EconomicSettlementRecord;
  obligation: EconomicObligation;
  evidence: EconomicSettlementEvidenceInput;
}): void => {
  const { existing, obligation, evidence } = input;
  if (
    existing.obligationId !== obligation.id ||
    existing.beneficiaryType !== obligation.beneficiaryType ||
    existing.beneficiaryPrincipalId !== obligation.beneficiaryPrincipalId ||
    existing.amountMinor !== obligation.amountMinor ||
    existing.provider !== clean(evidence.provider) ||
    existing.providerSettlementId !== clean(evidence.providerSettlementId) ||
    existing.authority !== evidence.authority ||
    existing.occurredAt !== clean(evidence.occurredAt) ||
    existing.observedAt !== clean(evidence.observedAt) ||
    existing.amountMinor !== evidence.amountMinor
  ) {
    throw new Error('ECONOMIC_SETTLEMENT_CONFLICT');
  }
};

export const recordEconomicSettlementEvidence = async (input: {
  storeId: string;
  obligationId: string;
  evidence: EconomicSettlementEvidenceInput;
}): Promise<RecordEconomicSettlementEvidenceResult> => {
  const storeId = clean(input.storeId);
  const obligationId = clean(input.obligationId);
  if (!storeId || !obligationId) {
    throw new Error('ECONOMIC_SETTLEMENT_TARGET_REQUIRED');
  }

  const settlementId = buildEconomicSettlementRecordId({
    provider: input.evidence.provider,
    providerSettlementId: input.evidence.providerSettlementId,
  });

  const obligationRef = adminDb.doc(economicObligationPath(storeId, obligationId));
  const settlementRef = adminDb.doc(economicSettlementPath(storeId, settlementId));

  return adminDb.runTransaction(async transaction => {
    const [obligationSnapshot, settlementSnapshot] = await Promise.all([
      transaction.get(obligationRef),
      transaction.get(settlementRef),
    ]);

    if (!obligationSnapshot.exists) {
      throw new Error('ECONOMIC_SETTLEMENT_OBLIGATION_NOT_FOUND');
    }

    const obligation = parseStoredObligation(
      obligationSnapshot.data(),
      storeId,
      obligationId
    );

    if (settlementSnapshot.exists) {
      const existing = parseStoredSettlement(
        settlementSnapshot.data(),
        storeId,
        settlementId
      );
      assertExistingSettlementMatches({
        existing,
        obligation,
        evidence: input.evidence,
      });
      if (
        obligation.status !== 'settled' ||
        obligation.settledAt !== existing.occurredAt
      ) {
        throw new Error('ECONOMIC_SETTLEMENT_STATE_INCONSISTENT');
      }
      return {
        duplicate: true,
        obligation,
        settlement: existing,
      };
    }

    const settlement = buildEconomicSettlementRecord({
      obligation,
      evidence: input.evidence,
    });
    const settledObligation = settleEconomicObligationFromEvidence({
      obligation,
      settlement,
    });

    transaction.set(settlementRef, settlement);
    transaction.update(obligationRef, {
      status: settledObligation.status,
      settledAt: settledObligation.settledAt,
    });

    return {
      duplicate: false,
      obligation: settledObligation,
      settlement,
    };
  });
};
