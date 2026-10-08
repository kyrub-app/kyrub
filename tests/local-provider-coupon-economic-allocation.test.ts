import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { buildMarketplaceEconomicAllocationSnapshot } from '../shared/economicFeesSubsidies';
import { buildStoreOrderProfitabilitySnapshot } from '../shared/storeOrderProfitability';
import type { StoreEconomicLedgerEntry } from '../shared/storeEconomicLedger';

const service = readFileSync('server/payments/storeEconomicLedgerService.ts', 'utf8');

test('provider capture resolves local intent and validates coupon snapshot before allocating discount', () => {
  assert.match(service, /payment\.context !== 'marketplace' && input\.payment\.context !== 'table' && input\.payment\.context !== 'pos'/);
  assert.match(service, /input\.payment\.paymentIntentId \|\| input\.event\.paymentIntentId/);
  assert.match(service, /intent\.target\.kind !== 'existing_order'/);
  assert.match(service, /intent\.target\.orderId !== payment\.orderId/);
  assert.match(service, /commercial\.discountTotal <= 0/);
  assert.match(service, /Math\.abs\(commercial\.subtotal - commercial\.discountTotal - commercial\.total\) > 0\.009/);
  assert.match(service, /Math\.abs\(commercial\.total - payment\.amount\) > 0\.009/);
  assert.match(service, /if \(!commercial\?\.couponCode\) return undefined/);
});

test('local coupon capture preserves gross, discount and net for profitability', () => {
  const allocation = buildMarketplaceEconomicAllocationSnapshot({
    subtotal: 30,
    discountTotal: 5,
    deliveryFee: 0,
    total: 25,
  });
  const capture: StoreEconomicLedgerEntry = {
    schemaVersion: 1, id: 'payment:capture:pay-local', storeId: 'store-1',
    kind: 'payment_capture', currency: 'BRL', amountMinor: 2500,
    paymentId: 'pay-local', paymentIntentId: 'intent-local',
    orderId: 'order-local', buyerId: 'buyer-1', paymentContext: 'table',
    paymentMethod: 'pix', provider: 'mercado_pago', providerPaymentId: 'mp-1',
    providerEventId: 'event-1', sourceAuthority: 'provider_webhook',
    reversalOfEntryId: '', occurredAt: '2026-10-08T10:00:00.000Z',
    economicAllocation: allocation,
  };
  const result = buildStoreOrderProfitabilitySnapshot({
    storeId: 'store-1', orderId: 'order-local', economicEntries: [capture],
    inventoryEvidence: null, calculatedAt: '2026-10-08T10:01:00.000Z',
  });
  assert.equal(result.merchandiseGrossMinor, 3000);
  assert.equal(result.storeDiscountMinor, 500);
  assert.equal(result.merchandiseRevenueMinor, 2500);
  assert.equal(result.paymentCapturedMinor, 2500);
  assert.equal(result.dataStatus, 'partial');
});


test('duplicate provider events do not rewrite existing capture and historical allocations remain optional', () => {
  assert.match(service, /const snapshot = await input\.transaction\.get\(captureRef\)/);
  assert.match(service, /if \(snapshot\.exists\) \{\s*assertEntryEquivalent\(parseEntry\(snapshot\.data\(\), storeId, captureId\), capture\);\s*return \{ writes: \[\] \};/);
  assert.match(service, /existing\.economicAllocation && expected\.economicAllocation &&/);
  assert.match(service, /STORE_ECONOMIC_LEDGER_ENTRY_CONFLICT:economicAllocation/);
  assert.match(service, /if \(!commercial\?\.couponCode\) return undefined/);
});
