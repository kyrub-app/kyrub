import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { describe, test } from 'node:test';
import { buildAdminEconomicObligationSnapshot } from '../shared/adminEconomicObligationSnapshot';
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
  state: 'eligible',
  settlementId: '',
  settledAt: '',
  integrityError: '',
  ...overrides,
} as EconomicObligationProjection);

describe('admin economic obligation snapshot', () => {
  test('keeps receivables and payables in separate read sections', () => {
    const snapshot = buildAdminEconomicObligationSnapshot({
      generatedAt: '2026-08-29T20:20:00.000Z',
      projections: [
        projection({ amountMinor: 5000, state: 'eligible' }),
        projection({
          projectionKind: 'payable',
          obligationKind: 'courier_payable',
          obligationId: 'courier-payable-1',
          beneficiaryPrincipalId: 'courier-1',
          fulfillmentId: 'f-1',
          amountMinor: 900,
          state: 'eligible',
        } as Partial<EconomicObligationProjection>),
      ],
    });

    assert.equal(snapshot.projectionCount, 2);
    assert.equal(snapshot.receivables.totals.eligibleMinor, 5000);
    assert.equal(snapshot.payables.totals.eligibleMinor, 900);
    assert.equal(snapshot.receivables.projectionKind, 'receivable');
    assert.equal(snapshot.payables.projectionKind, 'payable');
  });

  test('eligible is never promoted to settled by the admin snapshot', () => {
    const snapshot = buildAdminEconomicObligationSnapshot({
      generatedAt: '2026-08-29T20:20:00.000Z',
      projections: [projection({ amountMinor: 5000, state: 'eligible' })],
    });

    assert.equal(snapshot.receivables.totals.eligibleMinor, 5000);
    assert.equal(snapshot.receivables.totals.settledMinor, 0);
  });

  test('integrity errors remain visible but contribute to no monetary bucket', () => {
    const snapshot = buildAdminEconomicObligationSnapshot({
      generatedAt: '2026-08-29T20:20:00.000Z',
      projections: [
        projection({
          amountMinor: 999999,
          state: 'integrity_error',
          integrityError: 'settlement_mismatch',
        }),
      ],
    });

    assert.equal(snapshot.integrityErrorCount, 1);
    assert.equal(snapshot.receivables.totals.integrityErrorCount, 1);
    assert.equal(snapshot.receivables.totals.projectedMinor, 0);
    assert.equal(snapshot.receivables.totals.eligibleMinor, 0);
    assert.equal(snapshot.receivables.totals.settledMinor, 0);
    assert.equal(snapshot.receivables.totals.reversedMinor, 0);
  });

  test('beneficiary aggregation remains tenant scoped inside each kind', () => {
    const snapshot = buildAdminEconomicObligationSnapshot({
      generatedAt: '2026-08-29T20:20:00.000Z',
      projections: [
        projection({
          projectionKind: 'payable',
          obligationKind: 'courier_payable',
          obligationId: 'courier-payable-1',
          beneficiaryPrincipalId: 'courier-1',
          fulfillmentId: 'f-1',
          amountMinor: 500,
        } as Partial<EconomicObligationProjection>),
        projection({
          projectionKind: 'payable',
          obligationKind: 'courier_payable',
          obligationId: 'courier-payable-2',
          storeId: 'store-2',
          beneficiaryPrincipalId: 'courier-1',
          fulfillmentId: 'f-2',
          amountMinor: 700,
        } as Partial<EconomicObligationProjection>),
      ],
    });

    assert.equal(snapshot.payables.beneficiaries.length, 2);
    assert.equal(snapshot.payables.stores.length, 2);
  });

  test('duplicate obligations and invalid snapshot timestamps fail closed', () => {
    const row = projection();
    assert.throws(
      () => buildAdminEconomicObligationSnapshot({
        generatedAt: '2026-08-29T20:20:00.000Z',
        projections: [row, row],
      }),
      /ADMIN_ECONOMIC_OBLIGATION_DUPLICATE_OBLIGATION/
    );
    assert.throws(
      () => buildAdminEconomicObligationSnapshot({
        generatedAt: 'not-a-date',
        projections: [],
      }),
      /ADMIN_ECONOMIC_OBLIGATION_GENERATED_AT_INVALID/
    );
  });

  test('snapshot remains read-only and exposes no net, balance, custody or payout semantics', () => {
    const source = readFileSync('shared/adminEconomicObligationSnapshot.ts', 'utf8');
    assert.doesNotMatch(
      source,
      /economicNet|walletBalance|availableBalance|custodialBalance|ledgerBalance|createPayout|initiateTransfer|transferInstruction|application_fee_amount|splitRecipient|firebase|firestore|fetch\(|axios/i
    );
    assert.match(source, /receivables/);
    assert.match(source, /payables/);
    assert.match(source, /integrityErrorCount/);
  });
});
