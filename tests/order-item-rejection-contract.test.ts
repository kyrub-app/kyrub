import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const serviceSource = readFileSync(
  'server/payments/orderItemRejectionService.ts',
  'utf8'
);
const routerSource = readFileSync(
  'server/payments/storePaymentRefundRouter.ts',
  'utf8'
);
const clientSource = readFileSync(
  'src/utils/orderItemRejection.ts',
  'utf8'
);
const bridgeSource = readFileSync(
  'src/components/store/OrderRejectionScopeBridge.tsx',
  'utf8'
);
const runtimeSource = readFileSync(
  'src/components/RetailerPanelRuntimeRouter.tsx',
  'utf8'
);

test('merchant can choose whole-order or item-scoped rejection without silently refunding everything', () => {
  assert.match(bridgeSource, /Pedido inteiro/);
  assert.match(bridgeSource, /Itens específicos/);
  assert.match(bridgeSource, /Selecione item e quantidade/);
  assert.match(bridgeSource, /updateOrderStatusWithDecision\(storeId, orderId, 'rejected'/);
  assert.match(bridgeSource, /rejectPendingOrderItems/);
  assert.match(bridgeSource, /reembolso parcial correspondente/);
  assert.match(runtimeSource, /OrderRejectionScopeBridge/);
});

test('partial rejection is authoritative, pending-only, unpaid-only and preserves payment math before provider authorization', () => {
  assert.match(serviceSource, /clean\(order\.status\) !== 'pending'/);
  assert.match(serviceSource, /clean\(order\.paymentStatus\) !== 'unpaid'/);
  assert.match(serviceSource, /ORDER_ITEM_REJECTION_PARTIAL_REFUND_REQUIRED/);
  assert.match(serviceSource, /providerPaymentId/);
  assert.match(serviceSource, /ORDER_ITEM_REJECTION_PAYMENT_ALREADY_AUTHORIZED/);
  assert.match(serviceSource, /transaction\.update\(intentRef/);
  assert.match(serviceSource, /transaction\.update\(paymentRef/);
  assert.match(serviceSource, /amount: nextTotal/);
  assert.match(serviceSource, /orderDraft: nextOrderDraft/);
  assert.match(serviceSource, /stores\/\$\{canonicalStoreId\}\/orders\/\$\{orderId\}/);
  assert.match(serviceSource, /FieldValue\.arrayUnion\(event\)/);
});

test('partial item rejection uses authenticated server transport and never mutates orders directly in the browser', () => {
  assert.match(routerSource, /router\.post\('\/item-rejections'/);
  assert.match(routerSource, /await requireOwner/);
  assert.match(clientSource, /authorization: `Bearer \$\{token\}`/);
  assert.match(clientSource, /surface=refunds&path=item-rejections/);
  assert.doesNotMatch(clientSource, /updateDoc|setDoc|runTransaction/);
});
