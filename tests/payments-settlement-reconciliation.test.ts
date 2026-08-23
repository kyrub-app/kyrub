import assert from 'node:assert/strict';
import test from 'node:test';
import { buildCourierObligations, buildSettlementInstructions } from '../server/payments/settlementAdapter';
import type { KyrubPaymentTransaction } from '../shared/kyrubPaymentAllocations';

const transaction: KyrubPaymentTransaction = {
  schemaVersion: 1,
  transactionId: 'txn-1',
  payerUserId: 'buyer-1',
  purpose: 'order-1',
  currency: 'BRL',
  amountMinor: 10000,
  correlationId: 'corr-1',
  allocations: [
    { allocationId: 'a1', recipientUserId: 'merchant-1', role: 'merchant', amountMinor: 8500, status: 'locked' },
    { allocationId: 'a2', recipientUserId: 'courier-1', role: 'courier', amountMinor: 1000, status: 'pending' },
    { allocationId: 'a3', recipientUserId: 'kyrub', role: 'platform', amountMinor: 500, status: 'pending' },
  ],
};

test('allocation remains a planning record until a settlement instruction exists', () => {
  const instructions = buildSettlementInstructions({ transaction, rail: 'mercado_pago_1_1' });
  assert.equal(instructions.length, 3);
  assert.equal(instructions[0].status, 'planned');
  assert.equal(transaction.allocations[0].status, 'locked');
});

test('courier allocation is represented as an obligation until an authorized rail settles it', () => {
  const obligations = buildCourierObligations(transaction);
  assert.equal(obligations.length, 1);
  assert.equal(obligations[0].courierUserId, 'courier-1');
  assert.equal(obligations[0].status, 'owed');
  assert.equal(obligations[0].amountMinor, 1000);
});

test('reversed allocations do not create payable settlement instructions', () => {
  const reversed: KyrubPaymentTransaction = {
    ...transaction,
    allocations: transaction.allocations.map(item => item.allocationId === 'a2' ? { ...item, status: 'reversed' as const } : item),
  };
  const instructions = buildSettlementInstructions({ transaction: reversed, rail: 'manual_external' });
  assert.equal(instructions.find(item => item.allocationId === 'a2')?.status, 'reversed');
});
