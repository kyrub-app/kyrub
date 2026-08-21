import assert from 'node:assert/strict';
import test from 'node:test';
import type { KyrubFinancialProfile } from '../shared/kyrubFinancialProfile';
import {
  buildKyrubPaymentTransaction,
  replacePendingKyrubRecipient,
} from '../server/payments/paymentAllocationEngine';

const activeProfile = (userId: string): KyrubFinancialProfile => ({
  schemaVersion: 1,
  userId,
  status: 'active',
  capabilities: ['receive', 'split'],
  providerBindings: [],
  createdAt: '2026-08-21T20:00:00.000Z',
  updatedAt: '2026-08-21T20:00:00.000Z',
});

test('one payer can allocate an exact total across merchant and platform', () => {
  const transaction = buildKyrubPaymentTransaction({
    payerUserId: 'buyer-1',
    purpose: 'marketplace_order',
    amountMinor: 3200,
    correlationId: 'corr-split-1',
    allocations: [
      { recipientUserId: 'merchant-1', role: 'merchant', amountMinor: 3000 },
      { recipientUserId: 'platform-1', role: 'platform', amountMinor: 200 },
    ],
    recipientProfiles: [activeProfile('merchant-1'), activeProfile('platform-1')],
  });

  assert.equal(transaction.amountMinor, 3200);
  assert.equal(transaction.allocations.length, 2);
  assert.equal(transaction.allocations.reduce((sum, item) => sum + item.amountMinor, 0), 3200);
});

test('same engine supports merchant, platform and courier without special transaction types', () => {
  const transaction = buildKyrubPaymentTransaction({
    payerUserId: 'buyer-1',
    purpose: 'delivery_order',
    amountMinor: 4100,
    correlationId: 'corr-split-2',
    allocations: [
      { recipientUserId: 'merchant-1', role: 'merchant', amountMinor: 3000 },
      { recipientUserId: 'platform-1', role: 'platform', amountMinor: 200 },
      { recipientUserId: 'courier-1', role: 'courier', amountMinor: 900 },
    ],
    recipientProfiles: [
      activeProfile('merchant-1'),
      activeProfile('platform-1'),
      activeProfile('courier-1'),
    ],
  });

  assert.deepEqual(transaction.allocations.map(item => item.role), ['merchant', 'platform', 'courier']);
});

test('allocation sums must match the transaction exactly in minor units', () => {
  assert.throws(
    () => buildKyrubPaymentTransaction({
      payerUserId: 'buyer-1',
      purpose: 'marketplace_order',
      amountMinor: 3200,
      correlationId: 'corr-split-3',
      allocations: [
        { recipientUserId: 'merchant-1', role: 'merchant', amountMinor: 2999 },
        { recipientUserId: 'platform-1', role: 'platform', amountMinor: 200 },
      ],
      recipientProfiles: [activeProfile('merchant-1'), activeProfile('platform-1')],
    }),
    /PAYMENT_ALLOCATION_SUM_MISMATCH/
  );
});

test('recipient must have an active receiving financial profile', () => {
  const inactive = { ...activeProfile('courier-1'), status: 'under_review' as const };
  assert.throws(
    () => buildKyrubPaymentTransaction({
      payerUserId: 'buyer-1',
      purpose: 'delivery_order',
      amountMinor: 900,
      correlationId: 'corr-split-4',
      allocations: [
        { recipientUserId: 'courier-1', role: 'courier', amountMinor: 900 },
      ],
      recipientProfiles: [inactive],
    }),
    /PAYMENT_RECIPIENT_NOT_ELIGIBLE:courier-1/
  );
});

test('a pending allocation may select another already-known eligible recipient', () => {
  const transaction = buildKyrubPaymentTransaction({
    payerUserId: 'buyer-1',
    purpose: 'delivery_order',
    amountMinor: 900,
    correlationId: 'corr-split-5',
    allocations: [
      { recipientUserId: 'courier-placeholder', role: 'courier', amountMinor: 900 },
    ],
    recipientProfiles: [activeProfile('courier-placeholder')],
  });
  const changed = replacePendingKyrubRecipient({
    transaction,
    allocationId: transaction.allocations[0]!.allocationId,
    recipientProfile: activeProfile('courier-actual'),
  });
  assert.equal(changed.allocations[0]?.recipientUserId, 'courier-actual');
});
