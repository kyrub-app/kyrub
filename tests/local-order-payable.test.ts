import assert from 'node:assert/strict';
import test from 'node:test';
import { summarizeLocalOrderPayable } from '../server/attendance/localOrderPayable';

const order = (overrides: Record<string, unknown> = {}) => ({
  items: [
    {
      price: 10,
      quantity: 2,
      paidQuantity: 0,
      transferredQuantity: 1,
    },
    {
      price: 8,
      quantity: 1,
      paidQuantity: 0,
      transferredQuantity: 0,
    },
  ],
  ...overrides,
});

test('billable amount excludes quantities transferred out of the source order', () => {
  assert.deepEqual(summarizeLocalOrderPayable(order()), {
    billableAmount: 18,
    openAmount: 18,
    operationalPaidAmount: 0,
    transferredAmount: 10,
    hasOperationalPaidQuantity: false,
  });
});

test('legacy paid quantities remain explicit operational evidence instead of canonical money authority', () => {
  const value = order({
    items: [
      {
        price: 10,
        quantity: 2,
        paidQuantity: 1,
        transferredQuantity: 0,
      },
      {
        price: 8,
        quantity: 1,
        paidQuantity: 0,
        transferredQuantity: 0,
      },
    ],
  });
  assert.deepEqual(summarizeLocalOrderPayable(value), {
    billableAmount: 28,
    openAmount: 18,
    operationalPaidAmount: 10,
    transferredAmount: 0,
    hasOperationalPaidQuantity: true,
  });
});

test('zero-price lines remain valid while malformed line quantities fail closed', () => {
  assert.deepEqual(summarizeLocalOrderPayable({
    items: [{ price: 0, quantity: 1, paidQuantity: 0, transferredQuantity: 0 }],
  }), {
    billableAmount: 0,
    openAmount: 0,
    operationalPaidAmount: 0,
    transferredAmount: 0,
    hasOperationalPaidQuantity: false,
  });

  assert.throws(() => summarizeLocalOrderPayable({
    items: [{ price: 10, quantity: 1, paidQuantity: 1, transferredQuantity: 1 }],
  }), /LOCAL_ORDER_PAYABLE_ITEM_INVALID/);
});
