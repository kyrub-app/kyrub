import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { describe, test } from 'node:test';
import type { EconomicObligation } from '../shared/economicObligations';
import type { EconomicSettlementRecord } from '../shared/economicSettlements';
import {
  ECONOMIC_RECONCILIATION_AUTHORITY,
  buildEconomicReconciliationRecord,
  buildEconomicReconciliationRecordId,
  deriveEconomicReconciliationSummary,
  economicReconciliationPath,
} from '../shared/economicReconciliation';

const obligation = (
  overrides: Partial<EconomicObligation> = {}
): EconomicObligation => ({
  schemaVersion: 1,
  id: 'obligation:store_receivable:pay-1',
  storeId: 'store-1',
  kind: 'store_receivable',
  status: 'settled',
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
  settledAt: '2026-08-29T12:00:00.000Z',
  reversedAt: '',
  ...overrides,
});

const settlement = (
  overrides: Partial<EconomicSettlementRecord> = {}
): EconomicSettlementRecord => ({
  schemaVersion: 1,
  id: 'settlement:provider-x:settlement-123',
  storeId: 'store-1',
  obligationId: 'obligation:store_receivable:pay-1',
  beneficiaryType: 'store',
  beneficiaryPrincipalId: 'store:store-1',
  currency: 'BRL',
  amountMinor: 2500,
  provider: 'provider-x',
  providerSettlementId: 'settlement-123',
  authority: 'provider_statement',
  occurredAt: '2026-08-29T12:00:00.000Z',
  observedAt: '2026-08-29T12:01:00.000Z',
  ...overrides,
});

const reconciledAt = '2026-08-29T12:02:00.000Z';

describe('economic reconciliation foundation', () => {
  test('exact settled obligation and provider evidence reconcile as matched without changing source facts', () => {
    const receivable = obligation();
    const providerSettlement = settlement();
    const reconciliation = buildEconomicReconciliationRecord({
      obligation: receivable,
      settlement: providerSettlement,
      reconciledAt,
    });

    assert.equal(reconciliation.outcome, 'matched');
    assert.deepEqual(reconciliation.discrepancies, []);
    assert.equal(reconciliation.expectedMinor, 2500);
    assert.equal(reconciliation.settledMinor, 2500);
    assert.equal(reconciliation.differenceMinor, 0);
    assert.equal(reconciliation.authority, ECONOMIC_RECONCILIATION_AUTHORITY);
    assert.equal(receivable.status, 'settled');
    assert.equal(providerSettlement.amountMinor, 2500);
  });

  test('inconsistent source facts become explicit discrepancies instead of silent corrections', () => {
    const receivable = obligation({ status: 'eligible', settledAt: '' });
    const providerSettlement = settlement({
      storeId: 'store-2',
      obligationId: 'obligation:other',
      amountMinor: 2499,
      beneficiaryType: 'courier',
      beneficiaryPrincipalId: 'courier-1',
      occurredAt: '2026-08-29T12:05:00.000Z',
    });
    const reconciliation = buildEconomicReconciliationRecord({
      obligation: receivable,
      settlement: providerSettlement,
      reconciledAt: '2026-08-29T12:06:00.000Z',
    });

    assert.equal(reconciliation.outcome, 'discrepancy');
    assert.deepEqual(reconciliation.discrepancies, [
      'obligation_not_settled',
      'store_mismatch',
      'obligation_reference_mismatch',
      'amount_mismatch',
      'beneficiary_mismatch',
      'settled_at_mismatch',
    ]);
    assert.equal(reconciliation.differenceMinor, -1);
    assert.equal(receivable.status, 'eligible');
    assert.equal(providerSettlement.obligationId, 'obligation:other');
  });

  test('currency mismatch is surfaced as a discrepancy', () => {
    const providerSettlement = {
      ...settlement(),
      currency: 'USD',
    } as unknown as EconomicSettlementRecord;
    const reconciliation = buildEconomicReconciliationRecord({
      obligation: obligation(),
      settlement: providerSettlement,
      reconciledAt,
    });

    assert.equal(reconciliation.outcome, 'discrepancy');
    assert.deepEqual(reconciliation.discrepancies, ['currency_mismatch']);
  });

  test('reconciliation cannot predate observation of provider settlement evidence', () => {
    assert.throws(() => buildEconomicReconciliationRecord({
      obligation: obligation(),
      settlement: settlement(),
      reconciledAt: '2026-08-29T12:00:30.000Z',
    }), /ECONOMIC_RECONCILIATION_BEFORE_OBSERVATION/);
  });

  test('reconciliation ids and paths are deterministic and tenant scoped', () => {
    const id = buildEconomicReconciliationRecordId({
      provider: 'provider-x',
      providerSettlementId: 'settlement-123',
    });
    assert.equal(id, 'reconciliation:provider-x:settlement-123');
    assert.equal(
      economicReconciliationPath('store-1', id),
      'stores/store-1/economicReconciliations/reconciliation%3Aprovider-x%3Asettlement-123'
    );
  });

  test('summary keeps expected, settled and discrepancy values separate', () => {
    const matched = buildEconomicReconciliationRecord({
      obligation: obligation(),
      settlement: settlement(),
      reconciledAt,
    });
    const discrepant = buildEconomicReconciliationRecord({
      obligation: obligation({ id: 'obligation:store_receivable:pay-2', paymentId: 'pay-2' }),
      settlement: settlement({
        id: 'settlement:provider-x:settlement-456',
        obligationId: 'obligation:store_receivable:pay-2',
        providerSettlementId: 'settlement-456',
        amountMinor: 2490,
      }),
      reconciledAt,
    });
    const summary = deriveEconomicReconciliationSummary([matched, discrepant]);

    assert.deepEqual(summary, {
      currency: 'BRL',
      recordCount: 2,
      matchedCount: 1,
      discrepancyCount: 1,
      expectedMinor: 5000,
      settledMinor: 4990,
      differenceMinor: -10,
    });
  });
});

describe('economic reconciliation persistence', () => {
  test('service reads obligation, settlement and prior reconciliation before writing a deterministic record', () => {
    const service = readFileSync('server/payments/economicReconciliationService.ts', 'utf8');
    const obligationRead = service.indexOf('transaction.get(obligationRef)');
    const settlementRead = service.indexOf('transaction.get(settlementRef)');
    const reconciliationRead = service.indexOf('transaction.get(reconciliationRef)');
    const reconciliationWrite = service.indexOf('transaction.set(reconciliationRef, reconciliation)');

    assert.match(service, /adminDb\.runTransaction/);
    assert.ok(obligationRead >= 0);
    assert.ok(settlementRead >= 0);
    assert.ok(reconciliationRead > obligationRead && reconciliationRead > settlementRead);
    assert.ok(reconciliationWrite > reconciliationRead);
    assert.match(service, /buildEconomicReconciliationRecord/);
    assert.match(service, /buildEconomicReconciliationRecordId/);
  });

  test('replay is idempotent while a divergent stored reconciliation fails closed', () => {
    const service = readFileSync('server/payments/economicReconciliationService.ts', 'utf8');
    assert.match(service, /if \(reconciliationSnapshot\.exists\)/);
    assert.match(service, /duplicate: true/);
    assert.match(service, /assertReconciliationEquivalent/);
    assert.match(service, /ECONOMIC_RECONCILIATION_CONFLICT/);
  });

  test('reconciliation is observation-only and never mutates obligation or settlement source facts', () => {
    const service = readFileSync('server/payments/economicReconciliationService.ts', 'utf8');
    assert.doesNotMatch(service, /transaction\.update\(obligationRef/);
    assert.doesNotMatch(service, /transaction\.update\(settlementRef/);
    assert.doesNotMatch(service, /transaction\.delete\(obligationRef/);
    assert.doesNotMatch(service, /transaction\.delete\(settlementRef/);
    assert.doesNotMatch(
      service,
      /initiateSettlement|initiateTransfer|createPayout|walletBalance|custodialBalance|application_fee_amount|splitRecipient|fetch\(|axios/i
    );
  });

  test('reconciliation remains server-only under the browser deny-all boundary', () => {
    const service = readFileSync('server/payments/economicReconciliationService.ts', 'utf8');
    const rules = readFileSync('firestore.rules', 'utf8');
    assert.match(service, /adminDb/);
    assert.doesNotMatch(rules, /match \/economicReconciliations\//);
    assert.match(rules, /match \/\{document=\*\*\} \{\s*allow read, write: if false;/);
  });

  test('the Gate 2 chain keeps each authority in a separate layer', () => {
    const obligations = readFileSync('server/payments/economicObligationsService.ts', 'utf8');
    const settlements = readFileSync('server/payments/economicSettlementsService.ts', 'utf8');
    const reconciliation = readFileSync('server/payments/economicReconciliationService.ts', 'utf8');

    assert.match(obligations, /payment_capture/);
    assert.match(obligations, /buildStoreReceivableObligationFromCapture/);
    assert.match(settlements, /buildEconomicSettlementRecord/);
    assert.match(settlements, /settleEconomicObligationFromEvidence/);
    assert.match(reconciliation, /buildEconomicReconciliationRecord/);
    assert.doesNotMatch(reconciliation, /payment_capture/);
  });
});
