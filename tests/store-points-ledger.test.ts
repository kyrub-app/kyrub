import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import {
  STORE_POINTS_CURRENCY,
  buildStorePointBonusEntry,
  buildStorePointPurchaseEntry,
  buildStorePointReversalEntry,
  deriveStorePointBalance,
  normalizeStorePointsPerUnit,
} from '../shared/storePoints';

const purchaseInput = () => ({
  storeId: 'store-1',
  customerId: 'customer-1',
  orderId: 'order-1',
  paymentId: 'payment-1',
  paymentIntentId: 'intent-1',
  occurredAt: '2026-08-28T18:00:00.000Z',
  items: [
    {
      productId: 'burger',
      name: 'X-Burger',
      quantity: 3,
      storePointsPerUnit: 10,
    },
    {
      productId: 'soda',
      name: 'Refrigerante',
      quantity: 2,
      storePointsPerUnit: 4,
    },
  ],
});

test('product scoring is a non-negative integer store-points rule', () => {
  assert.equal(normalizeStorePointsPerUnit(undefined), 0);
  assert.equal(normalizeStorePointsPerUnit(0), 0);
  assert.equal(normalizeStorePointsPerUnit(25), 25);
  assert.throws(() => normalizeStorePointsPerUnit(-1), /STORE_POINTS_PER_UNIT_INVALID/);
  assert.throws(() => normalizeStorePointsPerUnit(1.5), /STORE_POINTS_PER_UNIT_INVALID/);
  assert.throws(() => normalizeStorePointsPerUnit('10'), /STORE_POINTS_PER_UNIT_INVALID/);
});

test('purchase base points use quantity multiplied by the snapshotted product rule', () => {
  const entry = buildStorePointPurchaseEntry(purchaseInput());
  assert.ok(entry);
  assert.equal(entry.currency, STORE_POINTS_CURRENCY);
  assert.equal(entry.kind, 'purchase_base');
  assert.equal(entry.amount, 38);
  assert.deepEqual(
    entry.purchaseItems.map(item => [item.productId, item.quantity, item.pointsPerUnit, item.pointsTotal]),
    [
      ['burger', 3, 10, 30],
      ['soda', 2, 4, 8],
    ]
  );
});

test('purchase posting is deterministic and zero-point products do not create movement', () => {
  const first = buildStorePointPurchaseEntry(purchaseInput());
  const retry = buildStorePointPurchaseEntry(purchaseInput());
  assert.ok(first);
  assert.ok(retry);
  assert.equal(first.id, 'purchase_base:payment-1');
  assert.equal(first.idempotencyKey, retry.idempotencyKey);
  assert.deepEqual(first, retry);

  assert.equal(
    buildStorePointPurchaseEntry({
      ...purchaseInput(),
      paymentId: 'payment-zero',
      items: [{
        productId: 'water',
        name: 'Água',
        quantity: 2,
        storePointsPerUnit: 0,
      }],
    }),
    null
  );
});

test('a later product rule change cannot recalculate an already built purchase entry', () => {
  const input = purchaseInput();
  const entry = buildStorePointPurchaseEntry(input);
  assert.ok(entry);
  assert.equal(entry.amount, 38);

  input.items[0].storePointsPerUnit = 999;
  input.items[1].storePointsPerUnit = 999;

  assert.equal(entry.amount, 38);
  assert.deepEqual(
    entry.purchaseItems.map(item => item.pointsPerUnit),
    [10, 4]
  );
});

test('bonuses are separate entries and reversals are compensating movements', () => {
  const purchase = buildStorePointPurchaseEntry(purchaseInput());
  assert.ok(purchase);
  const bonus = buildStorePointBonusEntry({
    bonusId: 'challenge-7',
    storeId: purchase.storeId,
    customerId: purchase.customerId,
    amount: 12,
    reason: 'challenge_completed',
    correlationId: 'challenge-7',
    occurredAt: '2026-08-28T18:01:00.000Z',
  });
  const reversal = buildStorePointReversalEntry({
    reversalId: 'manual-adjustment-payment-1',
    original: purchase,
    amount: 10,
    reason: 'manual_adjustment',
    occurredAt: '2026-08-28T18:02:00.000Z',
  });

  assert.equal(bonus.kind, 'bonus');
  assert.equal(bonus.amount, 12);
  assert.equal(reversal.kind, 'reversal');
  assert.equal(reversal.amount, -10);
  assert.equal(reversal.reversalOf, purchase.id);
  assert.equal(deriveStorePointBalance([purchase, bonus, reversal]), 40);
});

test('a completed full refund reverses the immutable purchase amount exactly once', () => {
  const purchase = buildStorePointPurchaseEntry(purchaseInput());
  assert.ok(purchase);
  const first = buildStorePointReversalEntry({
    reversalId: `refund:${purchase.paymentId}`,
    original: purchase,
    reason: 'payment_refunded',
    occurredAt: '2026-08-28T19:00:00.000Z',
  });
  const retry = buildStorePointReversalEntry({
    reversalId: `refund:${purchase.paymentId}`,
    original: purchase,
    reason: 'payment_refunded',
    occurredAt: '2026-08-28T19:00:00.000Z',
  });

  assert.equal(first.id, 'reversal:refund:payment-1');
  assert.equal(first.idempotencyKey, retry.idempotencyKey);
  assert.equal(first.amount, -38);
  assert.equal(first.reversalOf, purchase.id);
  assert.equal(deriveStorePointBalance([purchase, first]), 0);
});

test('checkout snapshots points server-side and browser never declares the award', () => {
  const checkoutClient = readFileSync('src/utils/marketplaceCheckout.ts', 'utf8');
  const router = readFileSync('server/payments/paymentIntentRouter.ts', 'utf8');
  const webhook = readFileSync('server/payments/paymentWebhookProcessor.ts', 'utf8');

  assert.doesNotMatch(checkoutClient, /storePointsPerUnit/);
  assert.match(router, /normalizeStorePointsPerUnit\(record\.storePointsPerUnit\)/);
  assert.match(router, /storePointsPerUnit: product\.storePointsPerUnit/);
  assert.match(webhook, /buildStorePointPurchaseEntry/);
  assert.match(webhook, /storePointLedgerPath/);
  assert.match(webhook, /pointLedgerExists/);
  assert.match(webhook, /effectiveStatus === 'paid'/);
});

test('automatic points reversal only runs at terminal refunded status', () => {
  const webhook = readFileSync('server/payments/paymentWebhookProcessor.ts', 'utf8');

  assert.match(webhook, /effectiveStatus === 'refunded'/);
  assert.match(webhook, /reversalId: `refund:\$\{paymentId\}`/);
  assert.match(webhook, /reason: 'payment_refunded'/);
  assert.match(webhook, /pointReversalExists/);
  assert.doesNotMatch(webhook, /effectiveStatus === 'refund_processing'/);
});
