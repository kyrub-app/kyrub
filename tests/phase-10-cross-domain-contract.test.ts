import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import type { CanonicalPayment } from '../src/utils/canonicalPayment';
import type { VerifiedPaymentProviderEvent } from '../src/utils/paymentProvider';
import {
  buildPaymentCaptureEconomicEntry,
} from '../shared/storeEconomicLedger';
import {
  buildMarketplaceEconomicAllocationSnapshot,
} from '../shared/economicFeesSubsidies';
import {
  buildStorePointPurchaseEntry,
  STORE_POINTS_CURRENCY,
} from '../shared/storePoints';

const storeId = 'store-release-candidate';
const buyerId = 'buyer-release-candidate';
const orderId = 'customer-order-release-candidate';
const paymentId = 'payment-release-candidate';
const paymentIntentId = 'intent-release-candidate';

const payment: CanonicalPayment = {
  id: paymentId,
  storeId,
  orderId,
  buyerId,
  amount: 29.5,
  currency: 'BRL',
  method: 'pix',
  context: 'marketplace',
  status: 'paid',
  provider: 'mercado_pago',
  providerPaymentId: 'provider-payment-release-candidate',
  idempotencyKey: 'payment-release-candidate-key',
  createdAt: '2026-08-29T14:00:00.000Z',
  updatedAt: '2026-08-29T14:01:00.000Z',
  paidAt: '2026-08-29T14:01:00.000Z',
  refundedAt: '',
};

const providerEvent: VerifiedPaymentProviderEvent = {
  provider: 'mercado_pago',
  eventId: 'provider-event-release-candidate',
  eventType: 'payment.paid',
  providerPaymentId: payment.providerPaymentId,
  paymentIntentId,
  amount: payment.amount,
  currency: 'BRL',
  method: 'pix',
  occurredAt: payment.paidAt,
  signatureVerified: true,
};

test('one authoritative paid purchase keeps the same lineage across economy and Store Points', () => {
  const allocation = buildMarketplaceEconomicAllocationSnapshot({
    subtotal: 30,
    discountTotal: 5,
    deliveryFee: 4.5,
    total: 29.5,
  });
  const capture = buildPaymentCaptureEconomicEntry({
    payment,
    event: providerEvent,
    economicAllocation: allocation,
  });
  const points = buildStorePointPurchaseEntry({
    storeId,
    customerId: buyerId,
    orderId,
    paymentId,
    paymentIntentId,
    occurredAt: providerEvent.occurredAt,
    items: [
      {
        productId: 'burger',
        name: 'X-Burger',
        quantity: 1,
        storePointsPerUnit: 10,
      },
    ],
  });

  assert.ok(points);
  assert.equal(capture.storeId, storeId);
  assert.equal(capture.paymentId, paymentId);
  assert.equal(capture.orderId, orderId);
  assert.equal(capture.providerEventId, providerEvent.eventId);
  assert.equal(capture.sourceAuthority, 'provider_webhook');
  assert.equal(capture.economicAllocation?.deliveryFeeMinor, 450);
  assert.equal(capture.economicAllocation?.courierRemunerationMinor, 450);

  assert.equal(points.storeId, storeId);
  assert.equal(points.customerId, buyerId);
  assert.equal(points.orderId, orderId);
  assert.equal(points.paymentId, paymentId);
  assert.equal(points.paymentIntentId, paymentIntentId);
  assert.equal(points.currency, STORE_POINTS_CURRENCY);
  assert.equal(points.amount, 10);
  assert.equal(points.id, `purchase_base:${paymentId}`);
});

test('the paid webhook is the shared authority boundary for order, economic ledger and Store Points', () => {
  const webhook = readFileSync('server/payments/paymentWebhookProcessor.ts', 'utf8');
  const materialization = readFileSync('src/utils/paymentOrderMaterialization.ts', 'utf8');

  assert.match(webhook, /normalizeVerifiedProviderEvent/);
  assert.match(webhook, /buildPaymentWebhookIdempotencyKey/);
  assert.match(webhook, /effectiveStatus === 'paid'/);
  assert.match(webhook, /prepareStoreEconomicLedgerPaymentPlan/);
  assert.match(webhook, /applyStoreEconomicLedgerPaymentPlan/);
  assert.match(webhook, /buildStorePointPurchaseEntry/);
  assert.match(webhook, /pointLedgerExists/);
  assert.match(webhook, /materializePaidMarketplaceOrder/);
  assert.match(webhook, /operationalOrderExists/);

  assert.match(materialization, /canMaterializeOperationalOrder/);
  assert.match(materialization, /PAYMENT_REQUIRED_BEFORE_ORDER_MATERIALIZATION/);
  assert.match(materialization, /paymentStatus: 'paid'/);
  assert.match(materialization, /source: 'customer'/);
});

test('the materialized order continues through operations without creating a second payment truth', () => {
  const retailer = readFileSync('src/components/RetailerPanel.tsx', 'utf8');
  const deliveryOpportunity = readFileSync(
    'server/delivery/deliveryOpportunityRouter.ts',
    'utf8'
  );
  const inventory = readFileSync(
    'server/inventory/orderInventoryService.ts',
    'utf8'
  );

  assert.match(retailer, /subscribeToStoreCustomerOrders/);
  assert.match(retailer, /customerOrders\.filter\(isOrderVisibleInKds\)/);
  assert.doesNotMatch(retailer, /setPaymentIntent.*paid|isPaid\s*=\s*true/i);

  assert.match(deliveryOpportunity, /fulfillmentType !== 'delivery'/);
  assert.match(deliveryOpportunity, /sourceOrderId/);
  assert.match(deliveryOpportunity, /deliveryClaims/);

  assert.match(inventory, /parseConfiguredLineSelectedOptions/);
  assert.match(inventory, /buildOrderInventoryConsumptionWithOptions/);
  assert.match(inventory, /optionInventoryImpacts/);
});

test('cross-domain rewards remain explicit: Store Points do not imply K-Coins, XP or vouchers', () => {
  const pointsDomain = readFileSync('shared/storePoints.ts', 'utf8');
  const webhook = readFileSync('server/payments/paymentWebhookProcessor.ts', 'utf8');

  assert.doesNotMatch(pointsDomain, /kcoin|k-coin|\bxp\b|voucher/i);
  assert.match(webhook, /buildStorePointPurchaseEntry/);
  assert.doesNotMatch(webhook, /awardKCoinsForPurchase|awardXpForPurchase|issueVoucherForPurchase/);
});

test('economic and loyalty facts retain deterministic audit correlation instead of mutable balances', () => {
  const capture = buildPaymentCaptureEconomicEntry({
    payment,
    event: providerEvent,
    economicAllocation: buildMarketplaceEconomicAllocationSnapshot({
      subtotal: 30,
      discountTotal: 5,
      deliveryFee: 4.5,
      total: 29.5,
    }),
  });
  const points = buildStorePointPurchaseEntry({
    storeId,
    customerId: buyerId,
    orderId,
    paymentId,
    paymentIntentId,
    occurredAt: providerEvent.occurredAt,
    items: [{
      productId: 'burger',
      name: 'X-Burger',
      quantity: 1,
      storePointsPerUnit: 10,
    }],
  });

  assert.ok(points);
  assert.equal(capture.id, `payment:capture:${paymentId}`);
  assert.equal(capture.providerEventId, providerEvent.eventId);
  assert.equal(points.idempotencyKey, `purchase_base:${paymentId}`);
  assert.equal(points.orderId, orderId);
  assert.equal(points.paymentId, paymentId);
});
