import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const read = (path: string): string =>
  readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');

const bridge = read('src/components/store/PaidOrderRefundBridge.tsx');
const router = read('server/payments/storePaymentRefundRouter.ts');
const service = read('server/payments/orderItemCancellationService.ts');
const refundSafety = read('server/payments/partialRefundSafetyService.ts');

test('KDS rejection asks for whole order or selected items before confirmation', () => {
  assert.match(bridge, /O que será cancelado\?/);
  assert.match(bridge, /Pedido inteiro/);
  assert.match(bridge, /Alguns itens/);
  assert.match(bridge, /Cancelar itens selecionados/);
  assert.match(bridge, /selectionCancelsEverything/);
});

test('partial item cancellation is idempotent and keeps the remaining order active', () => {
  assert.match(service, /orderItemCancellations\/\$\{operationId\}/);
  assert.match(service, /transaction\.create\(cancellationRef, cancellationRecord\)/);
  assert.match(service, /ORDER_ITEM_CANCELLATION_USE_FULL_REJECTION/);
  assert.match(service, /status\) !== 'pending'/);
  assert.doesNotMatch(service, /status:\s*'rejected'/);
});

test('paid partial cancellation refunds only the cancelled amount through the original Mercado Pago payment', () => {
  assert.match(service, /body:\s*JSON\.stringify\(\{ amount: money\(input\.amount\) \}\)/);
  assert.match(service, /kyrub:partial-refund:/);
  assert.match(service, /paymentPartialRefunds/);
  assert.match(service, /payment:partial_refund:/);
  assert.match(service, /partialRefundedAmount:\s*FieldValue\.increment/);
});

test('partial cancellation uses the authenticated refunds transport without weakening store ownership', () => {
  assert.match(router, /clean\(body\.operation\) === 'cancel-items'/);
  assert.match(router, /await requireOwner/);
  assert.match(router, /cancelOrderItemsWithRefund/);
  assert.match(bridge, /operation:\s*'cancel-items'/);
  assert.match(bridge, /authorization:\s*`Bearer \$\{token\}`/);
});

test('a later full refund is blocked when confirmed partial refunds already exist', () => {
  assert.match(refundSafety, /paymentPartialRefunds/);
  assert.match(refundSafety, /clean\(data\.status\) !== 'refunded'/);
  assert.match(refundSafety, /PAYMENT_REFUND_PARTIAL_HISTORY_REQUIRES_RESIDUAL/);
  assert.match(router, /assertFullRefundHasNoConfirmedPartialHistory/);
  assert.match(router, /reembolso residual/);
});
