import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { describe, test } from 'node:test';
import type { EconomicObligation } from '../shared/economicObligations';
import {
  buildEconomicSettlementRecord,
  buildEconomicSettlementRecordId,
  economicSettlementPath,
  type SettlementEvidenceAdapter,
} from '../shared/economicSettlements';

const obligation = (
  overrides: Partial<EconomicObligation> = {}
): EconomicObligation => ({
  schemaVersion: 1,
  id: 'obligation:store_receivable:pay-1',
  storeId: 'store-1',
  kind: 'store_receivable',
  status: 'eligible',
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
  eligibleAt: '2026-08-29T11:00:00.000Z',
  settledAt: '',
  reversedAt: '',
  ...overrides,
});

const evidence = () => ({
  provider: 'provider-x',
  providerSettlementId: 'settlement-123',
  amountMinor: 2500,
  occurredAt: '2026-08-29T12:00:00.000Z',
  observedAt: '2026-08-29T12:01:00.000Z',
  authority: 'provider_statement' as const,
});

describe('economic settlement evidence foundation', () => {
  test('confirmed settlement evidence is normalized from an eligible obligation without changing the obligation', () => {
    const receivable = obligation();
    const settlement = buildEconomicSettlementRecord({
      obligation: receivable,
      evidence: evidence(),
    });

    assert.equal(settlement.id, 'settlement:provider-x:settlement-123');
    assert.equal(settlement.storeId, receivable.storeId);
    assert.equal(settlement.obligationId, receivable.id);
    assert.equal(settlement.amountMinor, receivable.amountMinor);
    assert.equal(settlement.beneficiaryType, 'store');
    assert.equal(settlement.beneficiaryPrincipalId, 'store:store-1');
    assert.equal(settlement.authority, 'provider_statement');
    assert.equal(receivable.status, 'eligible');
    assert.equal(receivable.settledAt, '');
  });

  test('pending, reversed or already settled obligations cannot be declared settled by evidence normalization', () => {
    for (const status of ['pending', 'reversed', 'settled'] as const) {
      assert.throws(
        () => buildEconomicSettlementRecord({
          obligation: obligation({ status }),
          evidence: evidence(),
        }),
        new RegExp(`ECONOMIC_SETTLEMENT_OBLIGATION_NOT_ELIGIBLE:${status}`)
      );
    }
  });

  test('settlement evidence must match the full obligation amount exactly', () => {
    assert.throws(() => buildEconomicSettlementRecord({
      obligation: obligation(),
      evidence: { ...evidence(), amountMinor: 2499 },
    }), /ECONOMIC_SETTLEMENT_AMOUNT_MISMATCH/);
  });

  test('observation cannot predate the provider settlement event', () => {
    assert.throws(() => buildEconomicSettlementRecord({
      obligation: obligation(),
      evidence: {
        ...evidence(),
        observedAt: '2026-08-29T11:59:59.000Z',
      },
    }), /ECONOMIC_SETTLEMENT_OBSERVED_BEFORE_OCCURRED/);
  });

  test('store and courier obligations use the same settlement evidence contract', () => {
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
    const settlement = buildEconomicSettlementRecord({
      obligation: courier,
      evidence: { ...evidence(), amountMinor: 450 },
    });

    assert.equal(settlement.beneficiaryType, 'courier');
    assert.equal(settlement.beneficiaryPrincipalId, 'courier-1');
    assert.equal(settlement.amountMinor, 450);
  });

  test('ids are deterministic and settlement records stay tenant scoped', () => {
    const id = buildEconomicSettlementRecordId({
      provider: 'provider-x',
      providerSettlementId: 'settlement-123',
    });
    assert.equal(id, 'settlement:provider-x:settlement-123');
    assert.equal(
      economicSettlementPath('store-1', id),
      'stores/store-1/economicSettlements/settlement%3Aprovider-x%3Asettlement-123'
    );
  });

  test('adapter contract normalizes provider evidence only and does not execute movement', () => {
    class ExampleAdapter implements SettlementEvidenceAdapter<{ id: string }> {
      readonly provider = 'provider-x';
      normalizeEvidence(input: { id: string }) {
        return { ...evidence(), provider: this.provider, providerSettlementId: input.id };
      }
    }
    const adapter = new ExampleAdapter();
    assert.equal(adapter.normalizeEvidence({ id: 'abc' }).providerSettlementId, 'abc');

    const source = readFileSync('shared/economicSettlements.ts', 'utf8');
    assert.match(source, /normalizeEvidence/);
    assert.doesNotMatch(
      source,
      /initiateSettlement|initiateTransfer|createPayout|walletBalance|custodialBalance|application_fee_amount|splitRecipient|fetch\(|axios|firebase|firestore/i
    );
  });
});
