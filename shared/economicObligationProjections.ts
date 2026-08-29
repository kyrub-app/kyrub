import type {
  EconomicObligation,
  EconomicObligationKind,
} from './economicObligations.js';
import type { EconomicSettlementRecord } from './economicSettlements.js';

export type EconomicProjectionKind = 'receivable' | 'payable';

export type EconomicProjectionState =
  | 'projected'
  | 'eligible'
  | 'settled'
  | 'reversed'
  | 'integrity_error';

export type EconomicProjectionIntegrityError =
  | 'duplicate_settlement_records'
  | 'lifecycle_snapshot_inconsistent'
  | 'settlement_mismatch'
  | 'settlement_without_settled_obligation'
  | 'settled_obligation_without_settlement';

interface EconomicProjectionBase {
  projectionKind: EconomicProjectionKind;
  obligationKind: EconomicObligationKind;
  obligationId: string;
  storeId: string;
  beneficiaryPrincipalId: string;
  paymentId: string;
  orderId: string;
  fulfillmentId: string;
  currency: 'BRL';
  amountMinor: number;
  state: EconomicProjectionState;
  settlementId: string;
  settledAt: string;
  integrityError: EconomicProjectionIntegrityError | '';
}

export interface ReceivableProjection extends EconomicProjectionBase {
  projectionKind: 'receivable';
  obligationKind: 'store_receivable';
}

export interface PayableProjection extends EconomicProjectionBase {
  projectionKind: 'payable';
  obligationKind: 'courier_payable';
}

export type EconomicObligationProjection =
  | ReceivableProjection
  | PayableProjection;

const projectionKindFor = (
  obligationKind: EconomicObligationKind
): EconomicProjectionKind =>
  obligationKind === 'store_receivable' ? 'receivable' : 'payable';

const validIso = (value: string): boolean =>
  Boolean(value) && Number.isFinite(Date.parse(value));

const obligationLifecycleIsConsistent = (
  obligation: EconomicObligation
): boolean => {
  if (!validIso(obligation.createdAt)) return false;
  const createdAt = Date.parse(obligation.createdAt);

  if (obligation.status === 'pending') {
    return !obligation.eligibleAt && !obligation.settledAt && !obligation.reversedAt;
  }

  if (obligation.status === 'eligible') {
    return (
      validIso(obligation.eligibleAt) &&
      Date.parse(obligation.eligibleAt) >= createdAt &&
      !obligation.settledAt &&
      !obligation.reversedAt
    );
  }

  if (obligation.status === 'settled') {
    return (
      validIso(obligation.eligibleAt) &&
      validIso(obligation.settledAt) &&
      Date.parse(obligation.eligibleAt) >= createdAt &&
      Date.parse(obligation.settledAt) >= Date.parse(obligation.eligibleAt) &&
      !obligation.reversedAt
    );
  }

  if (!validIso(obligation.reversedAt) || obligation.settledAt) return false;
  if (Date.parse(obligation.reversedAt) < createdAt) return false;
  if (!obligation.eligibleAt) return true;
  return (
    validIso(obligation.eligibleAt) &&
    Date.parse(obligation.eligibleAt) >= createdAt &&
    Date.parse(obligation.reversedAt) >= Date.parse(obligation.eligibleAt)
  );
};

const settlementMatchesObligation = (
  obligation: EconomicObligation,
  settlement: EconomicSettlementRecord
): boolean =>
  settlement.storeId === obligation.storeId &&
  settlement.obligationId === obligation.id &&
  settlement.currency === obligation.currency &&
  settlement.amountMinor === obligation.amountMinor &&
  settlement.beneficiaryType === obligation.beneficiaryType &&
  settlement.beneficiaryPrincipalId === obligation.beneficiaryPrincipalId &&
  validIso(settlement.occurredAt) &&
  validIso(settlement.observedAt) &&
  Date.parse(settlement.observedAt) >= Date.parse(settlement.occurredAt) &&
  (settlement.authority === 'provider_webhook' ||
    settlement.authority === 'provider_statement');

const integrityProjection = (
  obligation: EconomicObligation,
  error: EconomicProjectionIntegrityError,
  settlement?: EconomicSettlementRecord
): EconomicObligationProjection => ({
  projectionKind: projectionKindFor(obligation.kind),
  obligationKind: obligation.kind,
  obligationId: obligation.id,
  storeId: obligation.storeId,
  beneficiaryPrincipalId: obligation.beneficiaryPrincipalId,
  paymentId: obligation.paymentId,
  orderId: obligation.orderId,
  fulfillmentId: obligation.fulfillmentId,
  currency: obligation.currency,
  amountMinor: obligation.amountMinor,
  state: 'integrity_error',
  settlementId: settlement?.id ?? '',
  settledAt: settlement?.occurredAt ?? '',
  integrityError: error,
}) as EconomicObligationProjection;

export const deriveEconomicObligationProjection = (input: {
  obligation: EconomicObligation;
  settlements: readonly EconomicSettlementRecord[];
}): EconomicObligationProjection => {
  const relatedSettlements = input.settlements.filter(
    settlement => settlement.obligationId === input.obligation.id
  );

  if (!obligationLifecycleIsConsistent(input.obligation)) {
    return integrityProjection(
      input.obligation,
      'lifecycle_snapshot_inconsistent',
      relatedSettlements[0]
    );
  }

  if (relatedSettlements.length > 1) {
    return integrityProjection(
      input.obligation,
      'duplicate_settlement_records',
      relatedSettlements[0]
    );
  }

  const settlement = relatedSettlements[0];
  if (settlement && !settlementMatchesObligation(input.obligation, settlement)) {
    return integrityProjection(input.obligation, 'settlement_mismatch', settlement);
  }

  if (input.obligation.status === 'settled') {
    if (!settlement) {
      return integrityProjection(
        input.obligation,
        'settled_obligation_without_settlement'
      );
    }
    if (input.obligation.settledAt !== settlement.occurredAt) {
      return integrityProjection(input.obligation, 'settlement_mismatch', settlement);
    }
    return {
      projectionKind: projectionKindFor(input.obligation.kind),
      obligationKind: input.obligation.kind,
      obligationId: input.obligation.id,
      storeId: input.obligation.storeId,
      beneficiaryPrincipalId: input.obligation.beneficiaryPrincipalId,
      paymentId: input.obligation.paymentId,
      orderId: input.obligation.orderId,
      fulfillmentId: input.obligation.fulfillmentId,
      currency: input.obligation.currency,
      amountMinor: input.obligation.amountMinor,
      state: 'settled',
      settlementId: settlement.id,
      settledAt: settlement.occurredAt,
      integrityError: '',
    } as EconomicObligationProjection;
  }

  if (settlement) {
    return integrityProjection(
      input.obligation,
      'settlement_without_settled_obligation',
      settlement
    );
  }

  const state: EconomicProjectionState =
    input.obligation.status === 'eligible'
      ? 'eligible'
      : input.obligation.status === 'reversed'
        ? 'reversed'
        : 'projected';

  return {
    projectionKind: projectionKindFor(input.obligation.kind),
    obligationKind: input.obligation.kind,
    obligationId: input.obligation.id,
    storeId: input.obligation.storeId,
    beneficiaryPrincipalId: input.obligation.beneficiaryPrincipalId,
    paymentId: input.obligation.paymentId,
    orderId: input.obligation.orderId,
    fulfillmentId: input.obligation.fulfillmentId,
    currency: input.obligation.currency,
    amountMinor: input.obligation.amountMinor,
    state,
    settlementId: '',
    settledAt: '',
    integrityError: '',
  } as EconomicObligationProjection;
};

export const deriveEconomicObligationProjections = (input: {
  obligations: readonly EconomicObligation[];
  settlements: readonly EconomicSettlementRecord[];
}): EconomicObligationProjection[] =>
  input.obligations.map(obligation =>
    deriveEconomicObligationProjection({
      obligation,
      settlements: input.settlements,
    })
  );

export const deriveReceivableProjections = (input: {
  obligations: readonly EconomicObligation[];
  settlements: readonly EconomicSettlementRecord[];
}): ReceivableProjection[] =>
  deriveEconomicObligationProjections(input).filter(
    (projection): projection is ReceivableProjection =>
      projection.projectionKind === 'receivable'
  );

export const derivePayableProjections = (input: {
  obligations: readonly EconomicObligation[];
  settlements: readonly EconomicSettlementRecord[];
}): PayableProjection[] =>
  deriveEconomicObligationProjections(input).filter(
    (projection): projection is PayableProjection =>
      projection.projectionKind === 'payable'
  );
