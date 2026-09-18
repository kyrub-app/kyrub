import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const webhookSource = readFileSync(
  'server/payments/paymentWebhookProcessor.ts',
  'utf8'
);
const destinationSource = readFileSync(
  'server/delivery/customerDestinationOrderResolutionService.ts',
  'utf8'
);
const economicLedgerSource = readFileSync(
  'server/payments/storeEconomicLedgerService.ts',
  'utf8'
);
const obligationsSource = readFileSync(
  'server/payments/economicObligationsService.ts',
  'utf8'
);

test('local provider events require an existing-order payment intent matching the canonical payment', () => {
  assert.match(webhookSource, /assertExistingOrderPaymentIntentMatchesPayment/);
  assert.match(webhookSource, /payment\.context !== 'table'/);
  assert.match(webhookSource, /payment\.context !== 'pos'/);
  assert.match(webhookSource, /intent\.context !== payment\.context/);
  assert.match(webhookSource, /intent\.target\.kind !== 'existing_order'/);
  assert.match(webhookSource, /intent\.target\.orderId !== payment\.orderId/);
  assert.match(webhookSource, /intent\.buyerId !== payment\.buyerId/);
  assert.match(webhookSource, /intent\.amount !== payment\.amount/);
  assert.match(webhookSource, /intent\.method !== payment\.method/);
  assert.match(webhookSource, /ExistingOrderPaymentIntentDocument/);
});

test('provider payment identity is preserved instead of overwriting it with the Kyrub intent id', () => {
  assert.match(webhookSource, /intent\.providerIntentId !== event\.providerPaymentId/);
  assert.match(webhookSource, /providerIntentId: event\.providerPaymentId/);
  assert.doesNotMatch(webhookSource, /providerIntentId: event\.paymentIntentId/);
});

test('local webhook synchronizes payment intent status without materializing or rewarding the existing order', () => {
  assert.match(webhookSource, /paymentIntent = normalizedIntent/);
  assert.match(webhookSource, /orderId = current\.orderId/);
  assert.match(webhookSource, /transaction\.update\(intentRef/);
  assert.match(webhookSource, /transaction\.update\(paymentRef/);
  assert.match(webhookSource, /if \(current\.context === 'marketplace'\)/);
  const localStart = webhookSource.indexOf("} else {\n      if (!intentSnapshot.exists)");
  const localEnd = webhookSource.indexOf('\n\n    economicLedgerPlan =');
  assert.ok(localStart >= 0 && localEnd > localStart);
  const localBranch = webhookSource.slice(localStart, localEnd);
  assert.doesNotMatch(localBranch, /materializePaidMarketplaceOrder/);
  assert.doesNotMatch(localBranch, /buildStorePointPurchaseEntry/);
  assert.doesNotMatch(localBranch, /prepareStoreChallengePaymentPlan/);
  assert.doesNotMatch(localBranch, /paymentStatus|paidQuantity/);
});

test('local intent bypasses marketplace destination geocoding and attachment', () => {
  assert.match(destinationSource, /PaymentIntentDocument/);
  assert.match(destinationSource, /if \(intent\.context !== 'marketplace'\) return null/);
  assert.match(destinationSource, /Existing local orders already have an operational Service Location/);
  assert.match(destinationSource, /if \(!prepared\) return/);
});

test('non-marketplace capture remains economic evidence without inventing receivable authority', () => {
  assert.match(economicLedgerSource, /payment\.context !== 'marketplace'/);
  assert.match(economicLedgerSource, /return undefined/);
  assert.match(obligationsSource, /Non-marketplace or otherwise non-allocated captures have no receivable/);
  assert.match(obligationsSource, /if \(!capture\.economicAllocation\)/);
  assert.match(obligationsSource, /return null/);
});
