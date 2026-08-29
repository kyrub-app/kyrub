import type {
  EconomicObligationProjection,
  EconomicProjectionKind,
} from './economicObligationProjections.js';
import {
  deriveEconomicProjectionAggregateTotals,
  deriveEconomicProjectionAggregatesByBeneficiary,
  deriveEconomicProjectionAggregatesByState,
  deriveEconomicProjectionAggregatesByStore,
  type EconomicProjectionAggregateBucket,
  type EconomicProjectionAggregateTotals,
} from './economicProjectionAggregates.js';

export const ADMIN_ECONOMIC_OBLIGATION_SCHEMA_VERSION = 1 as const;

export interface AdminEconomicObligationKindSnapshot {
  projectionKind: EconomicProjectionKind;
  totals: EconomicProjectionAggregateTotals;
  stores: EconomicProjectionAggregateBucket[];
  beneficiaries: EconomicProjectionAggregateBucket[];
  states: EconomicProjectionAggregateBucket[];
}

export interface AdminEconomicObligationSnapshot {
  schemaVersion: typeof ADMIN_ECONOMIC_OBLIGATION_SCHEMA_VERSION;
  generatedAt: string;
  projectionCount: number;
  integrityErrorCount: number;
  receivables: AdminEconomicObligationKindSnapshot;
  payables: AdminEconomicObligationKindSnapshot;
}

const validIso = (value: string): boolean =>
  Boolean(value) && Number.isFinite(Date.parse(value));

const assertUniqueProjectionIds = (
  projections: readonly EconomicObligationProjection[]
): void => {
  const seen = new Set<string>();
  for (const projection of projections) {
    const id = projection.obligationId.trim();
    if (!id) throw new Error('ADMIN_ECONOMIC_OBLIGATION_ID_INVALID');
    if (seen.has(id)) {
      throw new Error('ADMIN_ECONOMIC_OBLIGATION_DUPLICATE_OBLIGATION');
    }
    seen.add(id);
  }
};

const buildKindSnapshot = (
  projectionKind: EconomicProjectionKind,
  projections: readonly EconomicObligationProjection[]
): AdminEconomicObligationKindSnapshot => {
  const rows = projections.filter(
    projection => projection.projectionKind === projectionKind
  );
  return {
    projectionKind,
    totals: deriveEconomicProjectionAggregateTotals(rows),
    stores: deriveEconomicProjectionAggregatesByStore(rows),
    beneficiaries: deriveEconomicProjectionAggregatesByBeneficiary(rows),
    states: deriveEconomicProjectionAggregatesByState(rows),
  };
};

export const buildAdminEconomicObligationSnapshot = (input: {
  generatedAt: string;
  projections: readonly EconomicObligationProjection[];
}): AdminEconomicObligationSnapshot => {
  if (!validIso(input.generatedAt)) {
    throw new Error('ADMIN_ECONOMIC_OBLIGATION_GENERATED_AT_INVALID');
  }
  assertUniqueProjectionIds(input.projections);

  let integrityErrorCount = 0;
  for (const projection of input.projections) {
    if (projection.state === 'integrity_error') integrityErrorCount += 1;
  }

  return {
    schemaVersion: ADMIN_ECONOMIC_OBLIGATION_SCHEMA_VERSION,
    generatedAt: input.generatedAt,
    projectionCount: input.projections.length,
    integrityErrorCount,
    receivables: buildKindSnapshot('receivable', input.projections),
    payables: buildKindSnapshot('payable', input.projections),
  };
};
