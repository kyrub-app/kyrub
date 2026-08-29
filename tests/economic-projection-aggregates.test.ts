import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { describe, test } from 'node:test';
import {
  deriveEconomicProjectionAggregatesByBeneficiary,
  deriveEconomicProjectionAggregatesByState,
  deriveEconomicProjectionAggregatesByStore,
  deriveEconomicProjectionAggregateTotals,
} from '../shared/economicProjectionAggregates';
import type { EconomicObligationProjection } from '../shared/economicObligationProjections';

const projection = (
  overrides: Partial<EconomicObligationProjection> = {}
): EconomicObligationProjection => ({
  projectionKind: 'receivable',
  obligationKind: 'store_receivable',
  obligationId: 'obligation:store_receivable:pay-1',
  storeId: 'store-1',
  beneficiaryPrincipalId: 'store:store-1',
  paymentId: 'pay-1',
  orderId: 'order-1',
  fulfillmentId: '',
  currency: 'BRL',
  amountMinor: 2500,
  state: 'projected',
  settlementId: '',
  settledAt: '',
  integrityError: '',
  ...overrides,
} as EconomicObligationProjection);

describe('economic projection aggregate read model', () => {
  test('keeps projected, eligible, settled and reversed amounts in separate buckets', () => {
    const totals = deriveEconomicProjectionAggregateTotals([
      projection({ amountMinor: 1000, state: 'projected' }),
      projection({ obligationId: 'eligible', amountMinor: 2000, state: 'eligible' }),
      projection({ obligationId: 'settled', amountMinor: 3000, state: 'settled' }),
      projection({ obligationId: 'reversed', amountMinor: 4000, state: 'reversed' }),
    ]);

    assert.deepEqual(totals, {
      currency: 'BRL',
      projectedMinor: 1000,
      eligibleMinor: 2000,
      settledMinor: 3000,
      reversedMinor: 4000,
      projectedCount: 1,
      eligibleCount: 1,
      settledCount: 1,
      reversedCount: 1,
      integrityErrorCount: 0,
      projectionCount: 4,
    });
  });

  test('integrity errors are counted but never summed as money', () => {
    const totals = deriveEconomicProjectionAggregateTotals([
      projection({ amountMinor: 2500, state: 'eligible' }),
      projection({
        obligationId: 'broken',
        amountMinor: 999999,
        state: 'integrity_error',
        integrityError: 'settlement_mismatch',
      }),
    ]);

    assert.equal(totals.eligibleMinor, 2500);
    assert.equal(totals.integrityErrorCount, 1);
    assert.equal(totals.projectionCount, 2);
    assert.equal(totals.projectedMinor, 0);
    assert.equal(totals.settledMinor, 0);
  });

  test('duplicate obligation projections fail closed instead of double counting', () => {
    const duplicate = projection({ state: 'eligible' });
    assert.throws(
      () => deriveEconomicProjectionAggregateTotals([duplicate, { ...duplicate }]),
      /ECONOMIC_PROJECTION_AGGREGATE_DUPLICATE_OBLIGATION/
    );

    assert.throws(
      () => deriveEconomicProjectionAggregatesByStore([
        duplicate,
        { ...duplicate, storeId: 'store-other' },
      ]),
      /ECONOMIC_PROJECTION_AGGREGATE_DUPLICATE_OBLIGATION/
    );
  });

  test('store aggregation keeps tenants separate and can represent mixed receivable/payable activity', () => {
    const receivable = projection({ amountMinor: 2500, state: 'eligible' });
    const payable = projection({
      projectionKind: 'payable',
      obligationKind: 'courier_payable',
      obligationId: 'obligation:courier_payable:pay-1:f-1:c-1',
      beneficiaryPrincipalId: 'courier-1',
      fulfillmentId: 'f-1',
      amountMinor: 450,
      state: 'projected',
    } as Partial<EconomicObligationProjection>);
    const otherStore = projection({
      obligationId: 'other-store-receivable',
      storeId: 'store-2',
      beneficiaryPrincipalId: 'store:store-2',
      amountMinor: 7000,
      state: 'settled',
    });

    const stores = deriveEconomicProjectionAggregatesByStore([
      receivable,
      payable,
      otherStore,
    ]);

    assert.equal(stores.length, 2);
    assert.equal(stores[0].key, 'store-1');
    assert.equal(stores[0].projectionKind, 'mixed');
    assert.equal(stores[0].eligibleMinor, 2500);
    assert.equal(stores[0].projectedMinor, 450);
    assert.equal(stores[1].key, 'store-2');
    assert.equal(stores[1].settledMinor, 7000);
  });

  test('beneficiary aggregation is tenant scoped and never merges the same principal across stores', () => {
    const rows = deriveEconomicProjectionAggregatesByBeneficiary([
      projection({ state: 'eligible' }),
      projection({
        projectionKind: 'payable',
        obligationKind: 'courier_payable',
        obligationId: 'courier-payable-1',
        beneficiaryPrincipalId: 'courier-1',
        fulfillmentId: 'f-1',
        amountMinor: 450,
        state: 'eligible',
      } as Partial<EconomicObligationProjection>),
      projection({
        projectionKind: 'payable',
        obligationKind: 'courier_payable',
        obligationId: 'courier-payable-2',
        storeId: 'store-2',
        beneficiaryPrincipalId: 'courier-1',
        fulfillmentId: 'f-2',
        amountMinor: 600,
        state: 'eligible',
      } as Partial<EconomicObligationProjection>),
    ]);

    assert.equal(rows.length, 3);
    assert.equal(
      rows.find(row => row.key === 'store:store-1:beneficiary:store%3Astore-1')?.eligibleMinor,
      2500
    );
    assert.equal(
      rows.find(row => row.key === 'store:store-1:beneficiary:courier-1')?.eligibleMinor,
      450
    );
    assert.equal(
      rows.find(row => row.key === 'store:store-2:beneficiary:courier-1')?.eligibleMinor,
      600
    );
  });

  test('state aggregation makes eligibility and settlement independently readable', () => {
    const rows = deriveEconomicProjectionAggregatesByState([
      projection({ obligationId: 'a', amountMinor: 1000, state: 'eligible' }),
      projection({ obligationId: 'b', amountMinor: 2000, state: 'settled' }),
      projection({
        obligationId: 'c',
        amountMinor: 9000,
        state: 'integrity_error',
        integrityError: 'lifecycle_snapshot_inconsistent',
      }),
    ]);

    const eligible = rows.find(row => row.key === 'eligible');
    const settled = rows.find(row => row.key === 'settled');
    const invalid = rows.find(row => row.key === 'integrity_error');

    assert.equal(eligible?.eligibleMinor, 1000);
    assert.equal(eligible?.settledMinor, 0);
    assert.equal(settled?.settledMinor, 2000);
    assert.equal(settled?.eligibleMinor, 0);
    assert.equal(invalid?.integrityErrorCount, 1);
    assert.equal(invalid?.projectedMinor, 0);
    assert.equal(invalid?.eligibleMinor, 0);
    assert.equal(invalid?.settledMinor, 0);
  });

  test('invalid amounts and empty identities fail closed', () => {
    assert.throws(
      () => deriveEconomicProjectionAggregateTotals([
        projection({ amountMinor: 0 }),
      ]),
      /ECONOMIC_PROJECTION_AGGREGATE_AMOUNT_INVALID/
    );
    assert.throws(
      () => deriveEconomicProjectionAggregateTotals([
        projection({ obligationId: '' }),
      ]),
      /ECONOMIC_PROJECTION_AGGREGATE_ID_INVALID/
    );
    assert.throws(
      () => deriveEconomicProjectionAggregatesByStore([
        projection({ storeId: '' }),
      ]),
      /ECONOMIC_PROJECTION_AGGREGATE_KEY_INVALID/
    );
    assert.throws(
      () => deriveEconomicProjectionAggregatesByBeneficiary([
        projection({ beneficiaryPrincipalId: '' }),
      ]),
      /ECONOMIC_PROJECTION_AGGREGATE_KEY_INVALID/
    );
  });

  test('aggregate module is read-only and contains no balance, custody or transfer semantics', () => {
    const source = readFileSync('shared/economicProjectionAggregates.ts', 'utf8');
    assert.doesNotMatch(
      source,
      /walletBalance|availableBalance|custodialBalance|ledgerBalance|createPayout|initiateTransfer|transferInstruction|application_fee_amount|splitRecipient|firebase|firestore|fetch\(|axios/i
    );
    assert.match(source, /projectedMinor/);
    assert.match(source, /eligibleMinor/);
    assert.match(source, /settledMinor/);
    assert.match(source, /integrityErrorCount/);
  });
});
