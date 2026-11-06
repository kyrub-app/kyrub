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
