import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const read = (path: string): string =>
  readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');

const bridge = read('src/components/store/PaidOrderRefundBridge.tsx');
const controller = read('src/components/store/KdsScopedRejectionController.tsx');
const runtimeRouter = read('src/components/RetailerPanelRuntimeRouter.tsx');
const router = read('server/payments/storePaymentRefundRouter.ts');
const service = read('server/payments/orderItemCancellationService.ts');
const authoritativeService = read('server/payments/authoritativeOrderItemCancellationService.ts');
const authority = read('server/payments/orderCommercialRefundAuthorityService.ts');
const refundSafety = read('server/payments/partialRefundSafetyService.ts');

test('real KDS reject click is owned by the scoped controller before legacy bridges', () => {
  assert.match(runtimeRouter, /import \{ KdsScopedRejectionController \}/);
  const scopedMount = runtimeRouter.indexOf('<KdsScopedRejectionController');
  const refundMount = runtimeRouter.indexOf('<PaidOrderRefundBridge');
  assert.ok(scopedMount >= 0, 'scoped rejection controller must be mounted in pedidos');
  assert.ok(refundMount > scopedMount, 'scoped rejection controller must mount before the legacy refund bridge');

  assert.match(controller, /button\.textContent\?\.trim\(\) !== 'Recusar'/);
  assert.match(controller, /window\.addEventListener\('click', interceptNativeReject, true\)/);
  const prevent = controller.indexOf('event.preventDefault()');
  const stop = controller.indexOf('event.stopPropagation()');
  const stopImmediate = controller.indexOf('event.stopImmediatePropagation()');
  const lookup = controller.indexOf('getDoc(doc(db, getCustomerOrderDocumentPath');
  assert.ok(prevent >= 0 && stop > prevent && stopImmediate > stop, 'legacy click must be blocked synchronously');
  assert.ok(lookup > stopImmediate, 'legacy click must be blocked before any asynchronous order lookup');
});

test('KDS rejection asks for whole order or selected items before confirmation', () => {
  assert.match(controller, /O que será cancelado\?/);
  assert.match(controller, /Pedido inteiro/);
  assert.match(controller, /Alguns itens/);
  assert.match(controller, /Cancelar itens selecionados/);
  assert.match(controller, /cancelsEverything/);
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

test('partial cancellation uses authenticated refunds transport without weakening store ownership', () => {
  assert.match(router, /clean\(body\.operation\) === 'cancel-items'/);
  assert.match(router, /await requireOwner/);
  assert.match(router, /cancelOrderItemsWithAuthoritativeRefund/);
  assert.match(authoritativeService, /loadCommercialRefundAuthority/);
  assert.match(authoritativeService, /cancelOrderItemsWithRefund/);
  assert.match(controller, /operation:\s*'cancel-items'/);
  assert.match(controller, /authorization:\s*`Bearer \$\{token\}`/);
});

test('immutable commercial snapshot is the financial authority when it exists', () => {
  assert.match(authority, /source:\s*'immutable_commercial_snapshot'/);
  assert.match(authority, /discountAmount/);
  assert.match(authority, /settledAmount/);
  assert.match(authority, /netAmount/);
  assert.match(authoritativeService, /ORDER_COMMERCIAL_REFUND_AMOUNT_MISMATCH/);
  assert.match(authoritativeService, /ORDER_COMMERCIAL_REFUND_LINE_IDENTITY_MISMATCH/);
  assert.match(authoritativeService, /calculateAuthoritativeCancellationAmount/);
});

test('successful scoped rejection can close after authoritative acknowledgement', () => {
  assert.doesNotMatch(controller, /const reset = \(\): void => \{\s*if \(busy\) return;/);
  assert.match(controller, /await updateOrderStatusWithDecision[\s\S]*?notify\([\s\S]*?'success'[\s\S]*?\);\s*reset\(\);/);
});

test('a later full refund is blocked when confirmed partial refunds already exist', () => {
  assert.match(refundSafety, /paymentPartialRefunds/);
  assert.match(refundSafety, /clean\(data\.status\) !== 'refunded'/);
  assert.match(refundSafety, /PAYMENT_REFUND_PARTIAL_HISTORY_REQUIRES_RESIDUAL/);
  assert.match(router, /assertFullRefundHasNoConfirmedPartialHistory/);
  assert.match(router, /reembolso residual/);
});

test('legacy refund bridge still carries the full paid-order refund surface', () => {
  assert.match(bridge, /Reembolso necessário/);
  assert.match(bridge, /Confirmar reembolso/);
});
