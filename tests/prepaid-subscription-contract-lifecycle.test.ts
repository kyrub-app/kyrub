import assert from 'node:assert/strict';
import test from 'node:test';
import { activatePrepaidContractAfterVerifiedPayment, type PrepaidContractLifecycle } from '../server/payments/prepaidSubscriptionContractLifecycle.js';

const pending = (months: 3 | 6 | 12): PrepaidContractLifecycle => ({
  state: 'pending_payment', months, amountMinor: 15000, providerPaymentId: '',
  paymentConfirmedAt: '', startsAt: '', expiresAt: '',
});
const payment = { id: 'mp-123', status: 'approved', amountMinor: 15000,
  occurredAt: '2026-01-31T10:00:00.000Z', verifiedByProvider: true };

test('3, 6 and 12 month contracts activate only from verified approved payment', () => {
  for (const months of [3, 6, 12] as const) {
    const contract = activatePrepaidContractAfterVerifiedPayment(pending(months), payment);
    assert.equal(contract.state, 'active');
    assert.equal(contract.startsAt, payment.occurredAt);
    assert.equal(contract.expiresAt, new Date(Date.UTC(2026, months, 30, 10)).toISOString());
    assert.deepEqual(activatePrepaidContractAfterVerifiedPayment(contract, payment), contract);
  }
});

test('rejects unverified, pending, incorrect amount and duplicate payment', () => {
  assert.throws(() => activatePrepaidContractAfterVerifiedPayment(pending(3), {...payment, verifiedByProvider: false}));
  assert.throws(() => activatePrepaidContractAfterVerifiedPayment(pending(3), {...payment, status: 'pending'}));
  assert.throws(() => activatePrepaidContractAfterVerifiedPayment(pending(3), {...payment, amountMinor: 14999}));
  const active = activatePrepaidContractAfterVerifiedPayment(pending(3), payment);
  assert.throws(() => activatePrepaidContractAfterVerifiedPayment(active, {...payment, id: 'different'}));
});
