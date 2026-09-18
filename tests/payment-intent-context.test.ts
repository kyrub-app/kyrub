import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const intentSource = readFileSync(
  'src/utils/canonicalPaymentIntent.ts',
  'utf8'
);
const checkoutBridgeSource = readFileSync(
  'server/payments/mercadoPagoCheckoutBridge.ts',
  'utf8'
);
const pixProviderSource = readFileSync(
  'server/payments/mercadoPagoPixProvider.ts',
  'utf8'
);
const webhookSource = readFileSync(
  'server/payments/paymentWebhookProcessor.ts',
  'utf8'
);
const materializationSource = readFileSync(
  'src/utils/paymentOrderMaterialization.ts',
  'utf8'
);
const intentRouterSource = readFileSync(
  'server/payments/paymentIntentRouter.ts',
  'utf8'
);
const localFinancialSource = readFileSync(
  'server/attendance/localOrderFinancialContextService.ts',
  'utf8'
);

test('historical marketplace intents normalize to an explicit draft target', () => {
  assert.match(intentSource, /context\?: 'marketplace'/);
  assert.match(intentSource, /target\?: MarketplacePaymentIntentTarget/);
  assert.match(intentSource, /intent\.context === undefined\) return 'marketplace'/);
  assert.match(intentSource, /marketplaceIntent\.target \?\?/);
  assert.match(intentSource, /kind: 'marketplace_order_draft'/);
  assert.match(intentSource, /orderId: orderDraft\.draftId/);
  assert.match(intentSource, /targetOrderId !== orderDraft\.draftId/);
  assert.match(intentRouterSource, /normalizeCanonicalPaymentIntent\(\{/);
});

test('table and pos intents target an existing order and cannot own a marketplace draft', () => {
  assert.match(intentSource, /ExistingOrderPaymentIntentDocument/);
  assert.match(intentSource, /context: 'table' \| 'pos'/);
  assert.match(intentSource, /target: ExistingOrderPaymentIntentTarget/);
  assert.match(intentSource, /kind: 'existing_order'/);
  assert.match(intentSource, /orderDraft\?: never/);
  assert.match(intentSource, /Existing-order payment intent cannot contain a marketplace order draft/);
  assert.match(intentSource, /Existing-order payment intent target is invalid/);
  assert.match(intentSource, /payment intent target order id/);
});

test('marketplace materialization remains impossible for an existing-order intent', () => {
  assert.match(materializationSource, /intent\.context !== 'marketplace'/);
  assert.match(materializationSource, /PAYMENT_REQUIRED_BEFORE_ORDER_MATERIALIZATION/);
  assert.match(intentSource, /intent\.context === 'marketplace' && intent\.status === 'paid'/);
});

test('Mercado Pago provider is shared by typed intents while marketplace checkout bridge remains isolated', () => {
  assert.match(pixProviderSource, /MarketplaceCanonicalPaymentIntent/);
  assert.match(pixProviderSource, /ExistingOrderCanonicalPaymentIntent/);
  assert.match(pixProviderSource, /payerEmail: string/);
  assert.match(pixProviderSource, /input\.intent\.context === 'marketplace'/);
  assert.match(pixProviderSource, /input\.intent\.orderDraft\.buyerEmail/);
  assert.match(pixProviderSource, /input\.payerEmail/);
  assert.match(checkoutBridgeSource, /assertMarketplaceCheckoutContext/);
  assert.match(checkoutBridgeSource, /intent\.context !== payment\.context/);
  assert.match(checkoutBridgeSource, /intent\.context !== 'marketplace'/);
  assert.match(checkoutBridgeSource, /intent\.target\.kind !== 'marketplace_order_draft'/);
  assert.match(checkoutBridgeSource, /intent\.target\.orderId !== payment\.orderId/);
  assert.match(checkoutBridgeSource, /CHECKOUT_PAYMENT_TARGET_MISMATCH/);
  assert.match(checkoutBridgeSource, /createMercadoPagoPixPayment/);
});

test('marketplace webhook checks the explicit target before materializing or granting rewards', () => {
  assert.match(webhookSource, /intent\.context !== 'marketplace'/);
  assert.match(webhookSource, /intent\.target\.kind !== 'marketplace_order_draft'/);
  assert.match(webhookSource, /intent\.target\.orderId !== payment\.orderId/);
  assert.match(webhookSource, /intent\.orderDraft\.draftId !== payment\.orderId/);
  assert.match(webhookSource, /orderId: marketplaceIntent\.target\.orderId/);
  assert.match(webhookSource, /materializePaidMarketplaceOrder/);
});

test('local financial read model accepts only table or pos canonical payment evidence', () => {
  assert.match(localFinancialSource, /payment\.context !== 'table'/);
  assert.match(localFinancialSource, /payment\.context !== 'pos'/);
  assert.match(localFinancialSource, /LOCAL_ORDER_FINANCIAL_PAYMENT_CONTEXT_INVALID/);
});

test('marketplace payment router still has no local-attendance shortcut', () => {
  assert.doesNotMatch(intentRouterSource, /local-attendance/);
  assert.doesNotMatch(checkoutBridgeSource, /context === 'table'/);
  assert.doesNotMatch(checkoutBridgeSource, /context === 'pos'/);
});
