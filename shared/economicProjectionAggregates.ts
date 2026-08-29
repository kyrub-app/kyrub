import type {
  EconomicObligationProjection,
  EconomicProjectionKind,
} from './economicObligationProjections.js';

export type EconomicProjectionAggregateDimension =
  | 'store'
  | 'beneficiary'
  | 'state';

export interface EconomicProjectionAggregateTotals {
  currency: 'BRL';
  projectedMinor: number;
  eligibleMinor: number;
  settledMinor: number;
  reversedMinor: number;
  projectedCount: number;
  eligibleCount: number;
  settledCount: number;
  reversedCount: number;
  integrityErrorCount: number;
  projectionCount: number;
}

export interface EconomicProjectionAggregateBucket
  extends EconomicProjectionAggregateTotals {
  dimension: EconomicProjectionAggregateDimension;
  key: string;
  projectionKind: EconomicProjectionKind | 'mixed';
}

const emptyTotals = (): EconomicProjectionAggregateTotals => ({
  currency: 'BRL',
  projectedMinor: 0,
  eligibleMinor: 0,
  settledMinor: 0,
  reversedMinor: 0,
  projectedCount: 0,
  eligibleCount: 0,
  settledCount: 0,
  reversedCount: 0,
  integrityErrorCount: 0,
  projectionCount: 0,
});

const addSafe = (left: number, right: number, label: string): number => {
  const value = left + right;
  if (!Number.isSafeInteger(value)) {
    throw new Error(`ECONOMIC_PROJECTION_AGGREGATE_${label}_OVERFLOW`);
  }
  return value;
};

const assertProjectionAmount = (projection: EconomicObligationProjection): void => {
  if (!Number.isSafeInteger(projection.amountMinor) || projection.amountMinor <= 0) {
    throw new Error('ECONOMIC_PROJECTION_AGGREGATE_AMOUNT_INVALID');
  }
  if (projection.currency !== 'BRL') {
    throw new Error('ECONOMIC_PROJECTION_AGGREGATE_CURRENCY_INVALID');
  }
};

const addProjection = (
  totals: EconomicProjectionAggregateTotals,
  projection: EconomicObligationProjection
): void => {
  assertProjectionAmount(projection);
  totals.projectionCount = addSafe(totals.projectionCount, 1, 'COUNT');

  if (projection.state === 'integrity_error') {
    totals.integrityErrorCount = addSafe(
      totals.integrityErrorCount,
      1,
      'INTEGRITY_ERROR_COUNT'
    );
    return;
  }

  const amount = projection.amountMinor;
  if (projection.state === 'projected') {
    totals.projectedMinor = addSafe(totals.projectedMinor, amount, 'PROJECTED');
    totals.projectedCount = addSafe(totals.projectedCount, 1, 'PROJECTED_COUNT');
  } else if (projection.state === 'eligible') {
    totals.eligibleMinor = addSafe(totals.eligibleMinor, amount, 'ELIGIBLE');
    totals.eligibleCount = addSafe(totals.eligibleCount, 1, 'ELIGIBLE_COUNT');
  } else if (projection.state === 'settled') {
    totals.settledMinor = addSafe(totals.settledMinor, amount, 'SETTLED');
    totals.settledCount = addSafe(totals.settledCount, 1, 'SETTLED_COUNT');
  } else {
    totals.reversedMinor = addSafe(totals.reversedMinor, amount, 'REVERSED');
    totals.reversedCount = addSafe(totals.reversedCount, 1, 'REVERSED_COUNT');
  }
};

export const deriveEconomicProjectionAggregateTotals = (
  projections: readonly EconomicObligationProjection[]
): EconomicProjectionAggregateTotals => {
  const totals = emptyTotals();
  for (const projection of projections) addProjection(totals, projection);
  return totals;
};

const projectionKindForBucket = (
  projections: readonly EconomicObligationProjection[]
): EconomicProjectionKind | 'mixed' => {
  const first = projections[0]?.projectionKind;
  if (!first) return 'mixed';
  return projections.every(projection => projection.projectionKind === first)
    ? first
    : 'mixed';
};

const bucketBy = (
  projections: readonly EconomicObligationProjection[],
  dimension: EconomicProjectionAggregateDimension,
  keyFor: (projection: EconomicObligationProjection) => string
): EconomicProjectionAggregateBucket[] => {
  const grouped = new Map<string, EconomicObligationProjection[]>();
  for (const projection of projections) {
    const key = keyFor(projection).trim();
    if (!key) throw new Error('ECONOMIC_PROJECTION_AGGREGATE_KEY_INVALID');
    const current = grouped.get(key) ?? [];
    current.push(projection);
    grouped.set(key, current);
  }

  return [...grouped.entries()]
    .map(([key, rows]) => ({
      dimension,
      key,
      projectionKind: projectionKindForBucket(rows),
      ...deriveEconomicProjectionAggregateTotals(rows),
    }))
    .sort((left, right) => left.key.localeCompare(right.key));
};

export const deriveEconomicProjectionAggregatesByStore = (
  projections: readonly EconomicObligationProjection[]
): EconomicProjectionAggregateBucket[] =>
  bucketBy(projections, 'store', projection => projection.storeId);

export const deriveEconomicProjectionAggregatesByBeneficiary = (
  projections: readonly EconomicObligationProjection[]
): EconomicProjectionAggregateBucket[] =>
  bucketBy(
    projections,
    'beneficiary',
    projection => projection.beneficiaryPrincipalId
  );

export const deriveEconomicProjectionAggregatesByState = (
  projections: readonly EconomicObligationProjection[]
): EconomicProjectionAggregateBucket[] =>
  bucketBy(projections, 'state', projection => projection.state);
