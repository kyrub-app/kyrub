import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { describe, test } from 'node:test';
import type { EconomicObligation } from '../shared/economicObligations';
import {
  deriveEconomicObligationProjection,
  derivePayableProjections,
  deriveReceivableProjections,
} from '../shared/economicObligationProjections';
import type { EconomicSettlementRecord } from '../shared/economicSettlements';

const obligation = (
  overrides: Partial<EconomicObligation> = {}
): EconomicObligation => ({
  schemaVersion: 1,
  id: 'obligation:store_receivable:pay-1',
  storeId: 'store-1',
  kind: 'store_receivable',
  status: 'pending',
  currency: 'BRL',
  amountMinor: 2500,
  beneficiaryType: 'store',
  beneficiaryPrincipalId: 'store:store-1',
  paymentId: 'pay-1',
  orderId: 'order-1',
  fulfillmentId: '',
  sourceEconomicEntryId: 'payment:capture:pay-1',
  sourceAuthority: 'economic_allocation_snapshot',
  funding: {
    customerMinor: 2500,
    kyrubMinor: 0,
    partnerMinor: 0,
    storeFundedDiscountMinor: 500,
  },
  createdAt: '2026-08-29T10:00:00.000Z',
  eligibleAt: '',
  settledAt: '',
  reversedAt: '',
  ...overrides,
});

const settlement = (
  source: EconomicObligation,
  overrides: Partial<EconomicSettlementRecord> = {}
): EconomicSettlementRecord => ({
  schemaVersion: 1,
  id: 'settlement:provider-x:settlement-1',
  storeId: source.storeId,
  obligationId: source.id,
  beneficiaryType: source.beneficiaryType,
  beneficiaryPrincipalId: source.beneficiaryPrincipalId,
  currency: 'BRL',
  amountMinor: source.amountMinor,
  provider: 'provider-x',
  providerSettlementId: 'settlement-1',
  authority: 'provider_statement',
  occurredAt: '2026-08-29T12:00:00.000Z',
  observedAt: '2026-08-29T12:01:00.000Z',
  ...overrides,
});

describe('economic obligation read projections', () => {
  test('store receivable without settlement is projected and never implied settled', () => {
    const projection = deriveEconomicObligationProjection({
      obligation: obligation(),
      settlements: [],
    });

    assert.equal(projection.projectionKind, 'receivable');
    assert.equal(projection.state, 'projected');
    assert.equal(projection.amountMinor, 2500);
    assert.equal(projection.settlementId, '');
    assert.equal(projection.settledAt, '');
    assert.equal(projection.integrityError, '');
  });

  test('courier payable without settlement remains payable and not paid', () => {
    const courier = obligation({
      id: 'obligation:courier_payable:pay-1:fulfillment-1:courier-1',
      kind: 'courier_payable',
      amountMinor: 450,
      beneficiaryType: 'courier',
      beneficiaryPrincipalId: 'courier-1',
      fulfillmentId: 'fulfillment-1',
      funding: {
        customerMinor: 450,
        kyrubMinor: 0,
        partnerMinor: 0,
        storeFundedDiscountMinor: 0,
      },
    });

    const [projection] = derivePayableProjections({
      obligations: [courier],
      settlements: [],
    });

    assert.equal(projection.projectionKind, 'payable');
    assert.equal(projection.state, 'projected');
    assert.equal(projection.settlementId, '');
  });

  test('eligibility is visible but never means settlement', () => {
    const eligible = obligation({
      status: 'eligible',
      eligibleAt: '2026-08-29T11:00:00.000Z',
    });
    const projection = deriveEconomicObligationProjection({
      obligation: eligible,
      settlements: [],
    });

    assert.equal(projection.state, 'eligible');
    assert.equal(projection.settlementId, '');
    assert.equal(projection.settledAt, '');
  });

  test('settled projection requires a compatible authoritative settlement record', () => {
    const settledObligation = obligation({
      status: 'settled',
      eligibleAt: '2026-08-29T11:00:00.000Z',
      settledAt: '2026-08-29T12:00:00.000Z',
    });
    const authoritativeSettlement = settlement(settledObligation);
    const projection = deriveEconomicObligationProjection({
      obligation: settledObligation,
      settlements: [authoritativeSettlement],
    });

    assert.equal(projection.state, 'settled');
    assert.equal(projection.settlementId, authoritativeSettlement.id);
    assert.equal(projection.settledAt, authoritativeSettlement.occurredAt);
    assert.equal(projection.integrityError, '');
  });

  test('settled obligation without settlement evidence fails closed as integrity error', () => {
    const settledObligation = obligation({
      status: 'settled',
      eligibleAt: '2026-08-29T11:00:00.000Z',
      settledAt: '2026-08-29T12:00:00.000Z',
    });
    const projection = deriveEconomicObligationProjection({
      obligation: settledObligation,
      settlements: [],
    });

    assert.equal(projection.state, 'integrity_error');
    assert.equal(projection.integrityError, 'settled_obligation_without_settlement');
  });

  test('settlement attached to a non-settled obligation is inconsistent, never silently liquidated', () => {
    const eligible = obligation({
      status: 'eligible',
      eligibleAt: '2026-08-29T11:00:00.000Z',
    });
    const projection = deriveEconomicObligationProjection({
      obligation: eligible,
      settlements: [settlement(eligible)],
    });

    assert.equal(projection.state, 'integrity_error');
    assert.equal(projection.integrityError, 'settlement_without_settled_obligation');
  });

  test('amount, tenant, beneficiary or settlement evidence mismatch fails closed', () => {
    const settledObligation = obligation({
      status: 'settled',
      eligibleAt: '2026-08-29T11:00:00.000Z',
      settledAt: '2026-08-29T12:00:00.000Z',
    });

    for (const incompatible of [
      settlement(settledObligation, { amountMinor: 2499 }),
      settlement(settledObligation, { storeId: 'store-other' }),
      settlement(settledObligation, { beneficiaryPrincipalId: 'store:other' }),
      settlement(settledObligation, { observedAt: '2026-08-29T11:59:59.000Z' }),
    ]) {
      const projection = deriveEconomicObligationProjection({
        obligation: settledObligation,
        settlements: [incompatible],
      });
      assert.equal(projection.state, 'integrity_error');
      assert.equal(projection.integrityError, 'settlement_mismatch');
    }
  });

  test('settled timestamp must be the authoritative settlement occurrence time', () => {
    const settledObligation = obligation({
      status: 'settled',
      eligibleAt: '2026-08-29T11:00:00.000Z',
      settledAt: '2026-08-29T12:00:01.000Z',
    });
    const projection = deriveEconomicObligationProjection({
      obligation: settledObligation,
      settlements: [settlement(settledObligation)],
    });

    assert.equal(projection.state, 'integrity_error');
    assert.equal(projection.integrityError, 'settlement_mismatch');
  });

  test('impossible obligation lifecycle snapshots fail closed before projection', () => {
    for (const inconsistent of [
      obligation({ settledAt: '2026-08-29T12:00:00.000Z' }),
      obligation({ status: 'eligible', eligibleAt: '' }),
      obligation({
        status: 'settled',
        eligibleAt: '2026-08-29T11:00:00.000Z',
        settledAt: '2026-08-29T10:59:59.000Z',
      }),
      obligation({ status: 'reversed', reversedAt: '' }),
    ]) {
      const projection = deriveEconomicObligationProjection({
        obligation: inconsistent,
        settlements: [],
      });
      assert.equal(projection.state, 'integrity_error');
      assert.equal(projection.integrityError, 'lifecycle_snapshot_inconsistent');
    }
  });

  test('duplicate settlement records for one obligation fail closed', () => {
    const settledObligation = obligation({
      status: 'settled',
      eligibleAt: '2026-08-29T11:00:00.000Z',
      settledAt: '2026-08-29T12:00:00.000Z',
    });
    const first = settlement(settledObligation);
    const second = settlement(settledObligation, {
      id: 'settlement:provider-x:settlement-2',
      providerSettlementId: 'settlement-2',
    });
    const projection = deriveEconomicObligationProjection({
      obligation: settledObligation,
      settlements: [first, second],
    });

    assert.equal(projection.state, 'integrity_error');
    assert.equal(projection.integrityError, 'duplicate_settlement_records');
  });

  test('receivable and payable views are derived partitions, never mutable balances', () => {
    const receivable = obligation();
    const payable = obligation({
      id: 'obligation:courier_payable:pay-1:fulfillment-1:courier-1',
      kind: 'courier_payable',
      amountMinor: 450,
      beneficiaryType: 'courier',
      beneficiaryPrincipalId: 'courier-1',
      fulfillmentId: 'fulfillment-1',
    });

    assert.equal(deriveReceivableProjections({
      obligations: [receivable, payable],
      settlements: [],
    }).length, 1);
    assert.equal(derivePayableProjections({
      obligations: [receivable, payable],
      settlements: [],
    }).length, 1);

    const source = readFileSync('shared/economicObligationProjections.ts', 'utf8');
    assert.doesNotMatch(
      source,
      /walletBalance|availableBalance|custodialBalance|ledgerBalance|createPayout|initiateTransfer|application_fee_amount|splitRecipient|firebase|firestore|fetch\(|axios/i
    );
  });
});
