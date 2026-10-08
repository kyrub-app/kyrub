import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { describe, test } from 'node:test';
import { buildEconomicAllocationSnapshot } from '../shared/economicFeesSubsidies';
import type { StoreEconomicLedgerEntry } from '../shared/storeEconomicLedger';
import {
  buildStoreOrderProfitabilitySnapshot,
  storeOrderProfitabilityPath,
  type StoreOrderInventoryCostEvidence,
} from '../shared/storeOrderProfitability';

const allocation = buildEconomicAllocationSnapshot({
  merchandiseGrossMinor: 3000,
  customerPaidMinor: 2950,
  deliveryFeeMinor: 450,
  storeSubsidyMinor: 500,
  kyrubIncentiveMinor: 0,
  partnerSubsidyMinor: 0,
  observedCosts: [
    {
      id: 'mp-fee-1',
      kind: 'provider_processing',
      amountMinor: 100,
      borneBy: 'store',
      beneficiary: 'mercado_pago',
      source: 'provider_statement',
    },
  ],
});

const entry = (
  kind: StoreEconomicLedgerEntry['kind'],
  amountMinor: number,
  overrides: Partial<StoreEconomicLedgerEntry> = {}
): StoreEconomicLedgerEntry => ({
  schemaVersion: 1,
  id: `payment:${kind}:pay-1`,
  storeId: 'store-1',
  kind,
  currency: 'BRL',
  amountMinor,
  paymentId: 'pay-1',
  paymentIntentId: 'intent-1',
  orderId: 'order-1',
  buyerId: 'buyer-1',
  paymentContext: 'marketplace',
  paymentMethod: 'pix',
  provider: 'mercado_pago',
  providerPaymentId: 'provider-pay-1',
  providerEventId: `event-${kind}`,
  sourceAuthority: 'provider_webhook',
  reversalOfEntryId: '',
  occurredAt: '2026-09-30T12:00:00.000Z',
  economicAllocation: allocation,
  ...overrides,
});

const inventory = (
  overrides: Partial<StoreOrderInventoryCostEvidence> = {}
): StoreOrderInventoryCostEvidence => ({
  ledgerId: 'inventory-ledger-1',
  status: 'consumed',
  lines: [
    {
      inventoryItemId: 'bread',
      totalCostMinor: 150,
      costBasisStatus: 'complete',
    },
    {
      inventoryItemId: 'meat',
      totalCostMinor: 880,
      costBasisStatus: 'complete',
    },
  ],
  ...overrides,
});

describe('canonical store order profitability', () => {
  test('combines immutable merchandise facts with historical CMV and store-borne observed costs', () => {
    const snapshot = buildStoreOrderProfitabilitySnapshot({
      storeId: 'store-1',
      orderId: 'order-1',
      economicEntries: [entry('payment_capture', 2950)],
      inventoryEvidence: inventory(),
      calculatedAt: '2026-09-30T13:00:00.000Z',
    });

    assert.equal(snapshot.dataStatus, 'complete');
    assert.equal(snapshot.merchandiseGrossMinor, 3000);
    assert.equal(snapshot.storeDiscountMinor, 500);
    assert.equal(snapshot.merchandiseRevenueMinor, 2500);
    assert.equal(snapshot.deliveryFeeMinor, 450);
    assert.equal(snapshot.customerPaidMinor, 2950);
    assert.equal(snapshot.saleCmvMinor, 1030);
    assert.equal(snapshot.activeInventoryCmvMinor, 1030);
    assert.equal(snapshot.storeObservedVariableCostsMinor, 100);
    assert.equal(snapshot.contributionBeforeObservedCostsMinor, 1470);
    assert.equal(snapshot.contributionMinor, 1370);
    assert.equal(Math.round((snapshot.contributionMarginPercent ?? 0) * 100) / 100, 54.8);
    assert.equal(snapshot.paymentNetMinor, 2950);
    assert.equal(snapshot.effectiveMarginAvailable, true);
  });

  test('delivery remains outside store merchandise revenue', () => {
    const snapshot = buildStoreOrderProfitabilitySnapshot({
      storeId: 'store-1',
      orderId: 'order-1',
      economicEntries: [entry('payment_capture', 2950)],
      inventoryEvidence: inventory(),
      calculatedAt: '2026-09-30T13:00:00.000Z',
    });

    assert.equal(snapshot.merchandiseRevenueMinor, 2500);
    assert.notEqual(snapshot.merchandiseRevenueMinor, snapshot.customerPaidMinor);
    assert.equal(snapshot.customerPaidMinor, 2500 + 450);
  });

  test('incomplete CMV produces a partial snapshot and never fabricates contribution margin', () => {
    const snapshot = buildStoreOrderProfitabilitySnapshot({
      storeId: 'store-1',
      orderId: 'order-1',
      economicEntries: [entry('payment_capture', 2950)],
      inventoryEvidence: inventory({
        lines: [{
          inventoryItemId: 'meat',
          totalCostMinor: null,
          costBasisStatus: 'incomplete',
        }],
      }),
      calculatedAt: '2026-09-30T13:00:00.000Z',
    });

    assert.equal(snapshot.dataStatus, 'partial');
    assert.ok(snapshot.issues.includes('cmv_incomplete'));
    assert.equal(snapshot.saleCmvMinor, null);
    assert.equal(snapshot.contributionMinor, null);
    assert.equal(snapshot.contributionMarginPercent, null);
    assert.equal(snapshot.effectiveMarginAvailable, false);
  });

  test('full refund changes the financial lifecycle without pretending stock was restored', () => {
    const capture = entry('payment_capture', 2950);
    const refund = entry('payment_refund', -2950, {
      id: 'payment:refund:pay-1',
      reversalOfEntryId: capture.id,
      occurredAt: '2026-09-30T14:00:00.000Z',
    });
    const snapshot = buildStoreOrderProfitabilitySnapshot({
      storeId: 'store-1',
      orderId: 'order-1',
      economicEntries: [capture, refund],
      inventoryEvidence: inventory(),
      calculatedAt: '2026-09-30T15:00:00.000Z',
    });

    assert.equal(snapshot.financialState, 'refunded');
    assert.equal(snapshot.inventoryState, 'consumed');
    assert.equal(snapshot.paymentNetMinor, 0);
    assert.equal(snapshot.saleCmvMinor, 1030);
    assert.equal(snapshot.activeInventoryCmvMinor, 1030);
    assert.equal(snapshot.effectiveMarginAvailable, false);
  });

  test('local coupon Pix refund keeps historical gross and discount but disables effective margin', () => {
    const localAllocation = buildEconomicAllocationSnapshot({
      merchandiseGrossMinor: 3000,
      customerPaidMinor: 2500,
      deliveryFeeMinor: 0,
      storeSubsidyMinor: 500,
      kyrubIncentiveMinor: 0,
      partnerSubsidyMinor: 0,
      observedCosts: [],
    });
    const capture = entry('payment_capture', 2500, {
      paymentContext: 'table', economicAllocation: localAllocation,
    });
    const refund = entry('payment_refund', -2500, {
      id: 'payment:refund:pay-1',
      paymentContext: 'table',
      economicAllocation: localAllocation,
      reversalOfEntryId: capture.id,
      occurredAt: '2026-09-30T14:00:00.000Z',
    });
    const snapshot = buildStoreOrderProfitabilitySnapshot({
      storeId: 'store-1', orderId: 'order-1',
      economicEntries: [capture, refund],
      inventoryEvidence: inventory(),
      calculatedAt: '2026-09-30T15:00:00.000Z',
    });
    assert.equal(snapshot.financialState, 'refunded');
    assert.equal(snapshot.merchandiseGrossMinor, 3000);
    assert.equal(snapshot.storeDiscountMinor, 500);
    assert.equal(snapshot.customerPaidMinor, 2500);
    assert.equal(snapshot.paymentCapturedMinor, 2500);
    assert.equal(snapshot.paymentRefundedMinor, 2500);
    assert.equal(snapshot.paymentNetMinor, 0);
    assert.equal(snapshot.saleCmvMinor, 1030);
    assert.equal(snapshot.inventoryState, 'consumed');
    assert.equal(snapshot.effectiveMarginAvailable, false);
  });

  test('physical reversal restores active inventory CMV without rewriting historical sale CMV', () => {
    const snapshot = buildStoreOrderProfitabilitySnapshot({
      storeId: 'store-1',
      orderId: 'order-1',
      economicEntries: [entry('payment_capture', 2950)],
      inventoryEvidence: inventory({ status: 'reversed' }),
      calculatedAt: '2026-09-30T15:00:00.000Z',
    });

    assert.equal(snapshot.inventoryState, 'reversed');
    assert.equal(snapshot.saleCmvMinor, 1030);
    assert.equal(snapshot.activeInventoryCmvMinor, 0);
    assert.equal(snapshot.effectiveMarginAvailable, false);
  });

  test('missing allocation is explicit and does not derive revenue from payment total', () => {
    const capture = entry('payment_capture', 2950, { economicAllocation: undefined });
    const snapshot = buildStoreOrderProfitabilitySnapshot({
      storeId: 'store-1',
      orderId: 'order-1',
      economicEntries: [capture],
      inventoryEvidence: inventory(),
      calculatedAt: '2026-09-30T15:00:00.000Z',
    });

    assert.equal(snapshot.dataStatus, 'partial');
    assert.ok(snapshot.issues.includes('economic_allocation_missing'));
    assert.equal(snapshot.customerPaidMinor, null);
    assert.equal(snapshot.merchandiseRevenueMinor, null);
    assert.equal(snapshot.contributionMinor, null);
  });

  test('conflicting capture allocations remain partial rather than double-counting merchandise', () => {
    const conflictingAllocation = buildEconomicAllocationSnapshot({
      merchandiseGrossMinor: 3100,
      customerPaidMinor: 3050,
      deliveryFeeMinor: 450,
      storeSubsidyMinor: 500,
    });
    const snapshot = buildStoreOrderProfitabilitySnapshot({
      storeId: 'store-1',
      orderId: 'order-1',
      economicEntries: [
        entry('payment_capture', 2950),
        entry('payment_capture', 3050, {
          id: 'payment:capture:pay-2',
          paymentId: 'pay-2',
          providerPaymentId: 'provider-pay-2',
          economicAllocation: conflictingAllocation,
        }),
      ],
      inventoryEvidence: inventory(),
      calculatedAt: '2026-09-30T15:00:00.000Z',
    });

    assert.ok(snapshot.issues.includes('economic_allocation_conflict'));
    assert.equal(snapshot.merchandiseRevenueMinor, null);
    assert.equal(snapshot.paymentCapturedMinor, 6000);
  });

  test('profitability path is deterministic and order scoped', () => {
    assert.equal(
      storeOrderProfitabilityPath('store-1', 'order/with/slash'),
      'stores/store-1/orderProfitability/order%2Fwith%2Fslash'
    );
  });

  test('server reconciliation contract stays separate from browser Firestore writes', () => {
    const service = readFileSync('server/payments/storeOrderProfitabilityService.ts', 'utf8');
    assert.match(service, /inventoryOrderConsumptions/);
    assert.match(service, /listStoreEconomicLedgerEntries/);
    assert.match(service, /buildStoreOrderProfitabilitySnapshot/);
    assert.match(service, /sourceFingerprint/);
    assert.match(service, /orderProfitability/);
  });
});
