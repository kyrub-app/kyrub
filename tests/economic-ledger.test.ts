import assert from 'node:assert/strict';
import test from 'node:test';
import {
  deriveKyrubEconomicPositions,
  moneyToMinorUnits,
  normalizeKyrubEconomicLedger,
} from '../shared/kyrubEconomicLedger.js';
import { buildMarketplaceEconomicLedger } from '../server/payments/economicLedgerService.js';
import type { CanonicalPaymentIntent } from '../src/utils/canonicalPaymentIntent.js';

const marketplaceIntent = (overrides: Partial<CanonicalPaymentIntent> = {}): CanonicalPaymentIntent => ({
  id: 'pi_test',
  storeId: 'legacy-store',
  buyerId: 'buyer-1',
  method: 'pix',
  status: 'paid',
  amount: 90,
  currency: 'BRL',
  provider: 'mercado_pago',
  providerIntentId: 'pi_test',
  idempotencyKey: 'checkout-1',
  orderDraft: {
    draftId: 'order-1',
    storeId: 'legacy-store',
    buyerId: 'buyer-1',
    buyerName: 'Cliente',
    buyerEmail: 'cliente@example.com',
    fulfillmentType: 'pickup',
    deliveryAddress: '',
    customerNote: '',
    items: [
      {
        productId: 'burger-1',
        name: 'Burger',
        quantity: 1,
        unitPrice: 100,
        total: 100,
      },
    ],
    subtotal: 100,
    discountTotal: 10,
    couponCode: 'PROMO10',
    promotionSnapshot: {
      promotionId: 'promo-1',
      code: 'PROMO10',
      title: 'Promo 10',
      badge: '10 OFF',
      discountType: 'fixed',
      discountValue: 10,
      eligibleProductIds: ['burger-1'],
    },
    deliveryFee: 0,
    total: 90,
  },
  createdAt: '2026-08-28T20:00:00.000Z',
  updatedAt: '2026-08-28T20:01:00.000Z',
  expiresAt: '2026-08-28T20:15:00.000Z',
  ...overrides,
});

test('economic money uses integer minor units without silent precision loss', () => {
  assert.equal(moneyToMinorUnits(29.5), 2950);
  assert.equal(moneyToMinorUnits(0.01), 1);
  assert.throws(() => moneyToMinorUnits(1.005), /at most two decimal places/);
});

test('every economic transfer balances participant rights and obligations', () => {
  const ledger = normalizeKyrubEconomicLedger({
    id: 'ledger-1',
    transactionId: 'tx-1',
    storeId: 'store-1',
    orderId: 'order-1',
    paymentId: 'payment-1',
    currency: 'BRL',
    source: 'marketplace_payment',
    status: 'posted',
    entries: [
      {
        id: 'sale',
        kind: 'sale',
        amountMinor: 10000,
        fundedBy: { id: 'buyer-1', role: 'buyer' },
        owedTo: { id: 'store-1', role: 'merchant' },
      },
      {
        id: 'discount',
        kind: 'discount',
        amountMinor: 1000,
        fundedBy: { id: 'store-1', role: 'merchant' },
        owedTo: { id: 'buyer-1', role: 'buyer' },
      },
    ],
    createdAt: '2026-08-28T20:00:00.000Z',
    schemaVersion: 1,
  });

  const positions = deriveKyrubEconomicPositions(ledger.entries);
  assert.deepEqual(
    positions.map(position => [position.role, position.participantId, position.netMinor]),
    [
      ['buyer', 'buyer-1', -9000],
      ['merchant', 'store-1', 9000],
    ]
  );
  assert.equal(positions.reduce((sum, position) => sum + position.netMinor, 0), 0);
});

test('marketplace payment snapshots sale and merchant-funded promotion without recalculating history', () => {
  const ledger = buildMarketplaceEconomicLedger({
    paymentId: 'pay-1',
    intent: marketplaceIntent(),
    economicStoreId: 'canonical-store',
    occurredAt: '2026-08-28T20:02:00.000Z',
  });

  assert.equal(ledger.storeId, 'canonical-store');
  assert.equal(ledger.entries.length, 2);
  assert.deepEqual(
    ledger.entries.map(entry => [entry.kind, entry.amountMinor, entry.fundedBy.role, entry.owedTo.role]),
    [
      ['sale', 10000, 'buyer', 'merchant'],
      ['discount', 1000, 'merchant', 'buyer'],
    ]
  );
  assert.equal(ledger.entries[1]?.reference?.type, 'promotion');
  assert.equal(ledger.entries[1]?.reference?.id, 'promo-1');
});

test('marketplace ledger fails closed when freight economics have not assigned a beneficiary', () => {
  const base = marketplaceIntent();
  const intent = marketplaceIntent({
    amount: 95,
    orderDraft: {
      ...base.orderDraft,
      deliveryFee: 5,
      total: 95,
    },
  });
  assert.throws(
    () => buildMarketplaceEconomicLedger({
      paymentId: 'pay-delivery',
      intent,
      economicStoreId: 'canonical-store',
      occurredAt: '2026-08-28T20:02:00.000Z',
    }),
    /ECONOMIC_DELIVERY_COMPONENT_UNMODELED/
  );
});

test('future subsidies and incentives stay explicit instead of changing another entry in place', () => {
  const ledger = normalizeKyrubEconomicLedger({
    id: 'ledger-incentive',
    transactionId: 'tx-incentive',
    storeId: 'store-1',
    orderId: 'order-1',
    paymentId: 'payment-1',
    currency: 'BRL',
    source: 'manual_adjustment',
    status: 'posted',
    entries: [
      {
        id: 'freight',
        kind: 'freight',
        amountMinor: 800,
        fundedBy: { id: 'buyer-1', role: 'buyer' },
        owedTo: { id: 'courier-1', role: 'courier' },
      },
      {
        id: 'rain-bonus',
        kind: 'incentive',
        amountMinor: 300,
        fundedBy: { id: 'kyrub', role: 'platform' },
        owedTo: { id: 'courier-1', role: 'courier' },
      },
    ],
    createdAt: '2026-08-28T20:00:00.000Z',
    schemaVersion: 1,
  });
  const courier = deriveKyrubEconomicPositions(ledger.entries).find(
    position => position.role === 'courier' && position.participantId === 'courier-1'
  );
  assert.equal(courier?.creditsMinor, 1100);
  assert.equal(courier?.netMinor, 1100);
});
