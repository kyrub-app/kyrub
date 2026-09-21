import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { describe, test } from 'node:test';
import { getCustomerOrderItemOpenQuantity, parseCustomerOrder } from '../src/utils/customerOrders';

describe('table account item exclusion', () => {
  test('voided quantity is retained for audit and removed from open balance', () => {
    const order = parseCustomerOrder({
      id: 'staff-order-1', storeId: 'store-1', buyerId: 'walk-in-5', buyerName: 'Atendimento presencial', buyerEmail: '',
      fulfillmentType: 'dine_in', deliveryAddress: '', tableCode: '5', customerNote: '',
      items: [{ lineId: 'line-1', productId: 'product-1', name: 'X-BURGER', price: 29.5, quantity: 2, paidQuantity: 0, transferredQuantity: 0, voidedQuantity: 1, note: '', image: '', isService: false }],
      subtotal: 59, total: 59, status: 'ready', paymentStatus: 'unpaid', source: 'staff', sourceChannel: 'kyrub',
      operatorId: 'store-1', operatorName: 'Operador', createdAt: '2026-09-21T00:00:00.000Z', updatedAt: '2026-09-21T00:00:00.000Z',
    });
    assert.ok(order);
    assert.equal(order.items[0].quantity, 2);
    assert.equal(order.items[0].voidedQuantity, 1);
    assert.equal(getCustomerOrderItemOpenQuantity(order.items[0]), 1);
  });

  test('runtime records an audit entry and never deletes the order document', () => {
    const runtime = readFileSync('src/utils/legacyTableOperations.ts', 'utf8');
    assert.match(runtime, /export const excludeTableItem/);
    assert.match(runtime, /tableItemExclusions/);
    assert.match(runtime, /voidedQuantity:/);
    assert.match(runtime, /operatorId: user\.uid/);
    assert.match(runtime, /authorizationMode: 'temporary_simple_exclusion'/);
    assert.doesNotMatch(runtime, /transaction\.delete\(/);
  });

  test('account keeps Transferir, drops redundant large PDV return and exposes Excluir', () => {
    const workspace = readFileSync('src/components/customer/LegacyTableServiceWorkspace.tsx', 'utf8');
    const accountStart = workspace.indexOf("{view === 'account'");
    const transferStart = workspace.indexOf("{view === 'transfer'");
    const accountBlock = workspace.slice(accountStart, transferStart);
    assert.match(accountBlock, /> Transferir/);
    assert.doesNotMatch(accountBlock, /Voltar ao PDV/);
    assert.match(accountBlock, /onExclude=\{line => void handleExcludeItem\(line\)\}/);
    assert.match(workspace, /Excluir \${line\.name} da conta/);
  });
});
