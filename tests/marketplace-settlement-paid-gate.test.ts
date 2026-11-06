import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const materialization = readFileSync('src/utils/paymentOrderMaterialization.ts', 'utf8');
const settlement = readFileSync('server/payments/marketplaceOrderPaymentSettlementService.ts', 'utf8');

test('marketplace settlement refuses non-paid canonical payment intents', () => {
  const start = materialization.indexOf('export const settleExistingMarketplaceOrder');
  assert.ok(start >= 0);
  const source = materialization.slice(start);
  const paidGate = source.indexOf('!canMaterializeOperationalOrder(intent)');
  const paidMutation = source.indexOf("paymentStatus: 'paid'");
  assert.ok(paidGate > 0 && paidMutation > paidGate);
  assert.match(source, /PAYMENT_ORDER_SETTLEMENT_REQUIRES_VERIFIED_PAYMENT/);
});

test('settlement service obtains intent from server Firestore and binds store order buyer', () => {
  assert.match(settlement, /transaction\.get\(intentRef\)/);
  assert.match(settlement, /intent\.target\.orderId !== orderId/);
  assert.match(settlement, /intent\.storeId !== storeId/);
  assert.match(settlement, /intent\.buyerId !== order\.buyerId/);
  assert.match(settlement, /settleExistingMarketplaceOrder/);
});

test('marketplace settlement requires exact cents match', () => {
  assert.match(settlement, /Math\\.round\\(order\\.total \\* 100\\)/);
  assert.match(settlement, /Math\\.round\\(intent\\.amount \\* 100\\)/);
  assert.match(settlement, /orderTotalCents !== intentAmountCents/);
  assert.match(settlement, /PAYMENT_ORDER_SETTLEMENT_AMOUNT_MISMATCH/);
});

test('idempotent settlement refuses unpaid or cross-intent replay', () => {
  const paidGate = settlement.indexOf("intent.status !== 'paid'");
  const bindingGate = settlement.indexOf('recordedIntentId !== paymentIntentId');
  const earlyReturn = settlement.indexOf("if (order.paymentStatus === 'paid') return");
  assert.ok(paidGate > 0 && paidGate < earlyReturn);
  assert.ok(bindingGate > paidGate && bindingGate < earlyReturn);
  assert.match(settlement, /PAYMENT_ORDER_SETTLEMENT_INTENT_MISMATCH/);
});

test('settlement persists payment intent binding on legacy and canonical mirrors', () => {
  assert.match(settlement, /transaction\.set\(orderRef, \{ \.\.\.rawOrder, \.\.\.settled, paymentIntentId \}\)/);
  assert.match(settlement, /transaction\.set\(\s*adminDb\.doc\(`stores\/\$\{canonicalStoreId\}\/orders\/\$\{orderId\}`\),\s*\{\s*\.\.\.settled,\s*paymentIntentId,/);
});

test('verified webhook materialization records the original payment intent', () => {
  const webhook = readFileSync('server/payments/paymentWebhookProcessor.ts', 'utf8');
  assert.match(webhook, /paymentIntentId: marketplaceIntent!\.id/);
  assert.match(webhook, /if \(operationalOrder && !operationalOrderExists\)/);
  assert.match(webhook, /transaction\.set\(orderRef, \{/);
});
