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
const intentRouterSource = readFileSync(
  'server/payments/paymentIntentRouter.ts',
  'utf8'
);
const localFinancialSource = readFileSync(
  'server/attendance/localOrderFinancialContextService.ts',
  'utf8'
);

test('canonical payment intents normalize an explicit context while preserving historical marketplace intents', () => {
  assert.match(intentSource, /context\?: PaymentContext/);
  assert.match(intentSource, /paymentIntentContext/);
  assert.match(intentSource, /intent\.context === undefined\) return 'marketplace'/);
  assert.match(intentSource, /intent\.context !== 'marketplace'/);
  assert.match(intentSource, /intent\.context !== 'table'/);
  assert.match(intentSource, /intent\.context !== 'pos'/);
  assert.match(intentSource, /context,/);
  assert.match(intentRouterSource, /normalizeCanonicalPaymentIntent\(\{/);
});

test('current Mercado Pago checkout bridge remains marketplace-only until an existing-order intent target exists', () => {
  assert.match(checkoutBridgeSource, /assertMarketplaceCheckoutContext/);
  assert.match(checkoutBridgeSource, /paymentIntentContext\(intent\)/);
  assert.match(checkoutBridgeSource, /intentContext !== payment\.context/);
  assert.match(checkoutBridgeSource, /CHECKOUT_PAYMENT_CONTEXT_MISMATCH/);
  assert.match(checkoutBridgeSource, /intentContext !== 'marketplace'/);
  assert.match(checkoutBridgeSource, /CHECKOUT_PAYMENT_CONTEXT_UNSUPPORTED/);
  assert.match(checkoutBridgeSource, /createMercadoPagoPixPayment/);
});

test('local financial read model accepts only table or pos canonical payment evidence', () => {
  assert.match(localFinancialSource, /payment\.context !== 'table'/);
  assert.match(localFinancialSource, /payment\.context !== 'pos'/);
  assert.match(localFinancialSource, /LOCAL_ORDER_FINANCIAL_PAYMENT_CONTEXT_INVALID/);
});

test('this foundation does not expose a local payment-intent creation route', () => {
  assert.doesNotMatch(intentRouterSource, /local-attendance/);
  assert.doesNotMatch(checkoutBridgeSource, /context === 'table'/);
  assert.doesNotMatch(checkoutBridgeSource, /context === 'pos'/);
});
