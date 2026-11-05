import assert from 'node:assert/strict';
import test from 'node:test';
import { activatePrepaidContractAfterVerifiedPayment, calculatePrepaidRenewalPeriod, type PrepaidContractLifecycle } from '../server/payments/prepaidSubscriptionContractLifecycle.js';

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
    assert.equal(contract.expiresAt, new Date(Date.UTC(2026, months + 1, 0, 10)).toISOString());
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

test('early prepaid renewal begins at predecessor expiry, preserving remaining months', () => {
  const period = calculatePrepaidRenewalPeriod({
    previousExpiresAt: '2028-01-01T00:00:00.000Z',
    acceptedAt: '2027-01-01T00:00:00.000Z',
    paymentApprovedAt: '2027-01-02T00:00:00.000Z',
    months: 12,
  });
  assert.deepEqual(period, {
    startsAt: '2028-01-01T00:00:00.000Z',
    expiresAt: '2029-01-01T00:00:00.000Z',
  });
});

test('expired prepaid renewal begins at verified approval time', () => {
  const period = calculatePrepaidRenewalPeriod({
    previousExpiresAt: '2026-01-31T10:00:00.000Z',
    acceptedAt: '2027-02-01T00:00:00.000Z',
    paymentApprovedAt: '2027-02-02T10:00:00.000Z',
    months: 3,
  });
  assert.deepEqual(period, {
    startsAt: '2027-02-02T10:00:00.000Z',
    expiresAt: '2027-05-02T10:00:00.000Z',
  });
});

test('payment before acceptance cannot activate a prepaid renewal', () => {
  assert.throws(() => calculatePrepaidRenewalPeriod({
    previousExpiresAt: '2028-01-01T00:00:00.000Z',
    acceptedAt: '2027-01-02T00:00:00.000Z',
    paymentApprovedAt: '2027-01-01T00:00:00.000Z',
    months: 12,
  }), /RENEWAL_PAYMENT_PRECEDES_ACCEPTANCE/);
});

test('renewal period rejects missing timezone and unsupported terms', () => {
  const base = {
    previousExpiresAt: '2028-01-01T00:00:00.000Z',
    acceptedAt: '2027-01-01T00:00:00.000Z',
    paymentApprovedAt: '2027-01-01T00:01:00.000Z',
    months: 12 as const,
  };
  assert.throws(() => calculatePrepaidRenewalPeriod({
    ...base, previousExpiresAt: '2028-01-01T00:00:00',
  }), /INVALID_RENEWAL_PERIOD_TIMESTAMP/);
  assert.throws(() => calculatePrepaidRenewalPeriod({
    ...base, months: 2 as 12,
  }), /INVALID_PREPAID_CONTRACT_TERM/);
});
