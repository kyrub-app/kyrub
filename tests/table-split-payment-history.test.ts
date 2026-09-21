import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { describe, test } from 'node:test';
import {
  getCustomerOrderItemOutstandingAmount,
  getCustomerOrderItemOpenQuantity,
  resolveCustomerOrderPaymentStatus,
  type CustomerOrderItem,
} from '../src/utils/customerOrders';

const item = (overrides: Partial<CustomerOrderItem> = {}): CustomerOrderItem => ({
  lineId: 'line-1', productId: 'product-1', name: 'X-BURGER', price: 29.5,
  quantity: 1, paidQuantity: 0, transferredQuantity: 0, voidedQuantity: 0,
  settledAmount: 0, discountAmount: 0, note: '', image: '', isService: false,
  ...overrides,
});

describe('split table payments and history', () => {
  test('discount and partial payment reduce monetary outstanding without erasing the line', () => {
    const line = item({ discountAmount: 4.5, settledAmount: 10 });
    assert.equal(getCustomerOrderItemOutstandingAmount(line), 15);
    assert.equal(getCustomerOrderItemOpenQuantity(line), 1);
    assert.equal(resolveCustomerOrderPaymentStatus([line]), 'partial');
  });

  test('fully settled monetary line closes even when paidQuantity remains legacy-zero', () => {
    const line = item({ discountAmount: 4.5, settledAmount: 25 });
    assert.equal(getCustomerOrderItemOutstandingAmount(line), 0);
    assert.equal(getCustomerOrderItemOpenQuantity(line), 0);
    assert.equal(resolveCustomerOrderPaymentStatus([line]), 'paid');
  });

  test('table account exposes history, amount field, coupon adjustment and explicit Pix confirmation', () => {
    const workspace = readFileSync('src/components/customer/LegacyTableServiceWorkspace.tsx', 'utf8');
    assert.match(workspace, /Histórico de pagamentos e ajustes/);
    assert.match(workspace, /Valor a pagar agora/);
    assert.match(workspace, /Usar saldo/);
    assert.match(workspace, /registerTablePartialPayment/);
    assert.match(workspace, /applyTableCoupon/);
    assert.match(workspace, /onPixRequested/);
    assert.match(workspace, /Cupom bloqueado após o primeiro pagamento/);
  });

  test('local Pix intent accepts a server-capped requested amount', () => {
    const shared = readFileSync('shared/localPaymentIntent.ts', 'utf8');
    const service = readFileSync('server/attendance/localPaymentIntentService.ts', 'utf8');
    assert.match(shared, /amount\?: number/);
    assert.match(service, /LOCAL_PAYMENT_INTENT_AMOUNT_EXCEEDS_OUTSTANDING/);
    assert.match(service, /request\.amount \?\? outstandingSubtotal/);
  });

  test('canonical Pix subtracts earlier operational payments instead of blocking mixed methods', () => {
    const service = readFileSync('server/attendance/localPaymentIntentService.ts', 'utf8');
    assert.match(service, /legacyOrderRef/);
    assert.match(service, /payable\.operationalPaidAmount/);
    assert.match(service, /canonicalPaidAmount \+ payable\.operationalPaidAmount/);
    assert.doesNotMatch(service, /if \(payable\.hasOperationalPaidQuantity\) throw new Error\('LOCAL_PAYMENT_INTENT_RECONCILIATION_REQUIRED'\)/);
  });
});
