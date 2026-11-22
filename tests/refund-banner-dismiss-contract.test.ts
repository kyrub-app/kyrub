import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const bridge = readFileSync('src/components/store/PaidOrderRefundBridge.tsx', 'utf8');
const router = readFileSync('server/payments/storePaymentRefundRouter.ts', 'utf8');
const guard = readFileSync('server/payments/partialRefundSafetyService.ts', 'utf8');

test('paid but unrefunded cancelled order remains visible as an unresolved financial obligation', () => {
  assert.match(bridge, /order\.status === 'rejected' \|\| order\.status === 'cancelled'/);
  assert.match(bridge, /order\.paymentStatus === 'paid'/);
  assert.match(bridge, /order\.refundStatus !== 'refunded'/);
  assert.match(bridge, /Reembolso necessário/);
  assert.match(bridge, /Pendência financeira · ver detalhes/);
});

test('dismissal minimizes overlay rather than erasing payment, refund or order state', () => {
  assert.match(bridge, /minimizedRefundOrderId === active\.id/);
  assert.match(bridge, /setMinimizedRefundOrderId\(active\.id\)/);
  assert.match(bridge, /setMinimizedRefundOrderId\(null\)/);
  assert.match(bridge, /Minimizar aviso de reembolso/);
  assert.match(bridge, /Reabrir pendência financeira do pedido/);
  assert.doesNotMatch(bridge, /updateDoc\(.*refundStatus/);
});

test('a missing/zero operational amount is not presented as a real refund of R$ 0', () => {
  assert.match(bridge, /operationalRefundDisplayAmount/);
  assert.match(bridge, /Valor a conferir/);
  assert.match(bridge, /Valor do reembolso a conferir/);
  assert.match(bridge, /selectedDisplayAmount === null/);
  assert.match(bridge, /disabled=\{busy \|\| !reason\.trim\(\) \|\| selectedDisplayAmount === null\}/);
  assert.match(bridge, /servidor usa a cobrança canônica/);
});

test('refund safety gate remains unchanged for uncertain partial refund histories', () => {
  assert.match(router, /await assertFullRefundHasNoConfirmedPartialHistory\(\{ storeId, orderId \}\)/);
  assert.match(guard, /PAYMENT_REFUND_PARTIAL_HISTORY_REVIEW_REQUIRED/);
  assert.match(guard, /PAYMENT_REFUND_PARTIAL_HISTORY_REQUIRES_RESIDUAL/);
});
