import assert from 'node:assert/strict';
import test from 'node:test';
import { scheduleOfficialPlanFromConfirmedPayment } from '../server/payments/officialPlanActivationSchedule.js';

test('canonical official plan schedule starts at verified payment and clamps calendar month', () => {
  for (const [paidAt, expiresAt] of [
    ['2026-01-31T12:34:56.000Z', '2026-02-28T12:34:56.000Z'],
    ['2028-01-31T12:34:56.000Z', '2028-02-29T12:34:56.000Z'],
    ['2026-03-31T12:34:56.000Z', '2026-04-30T12:34:56.000Z'],
    ['2026-12-31T12:34:56.000Z', '2027-01-31T12:34:56.000Z'],
  ] as const) {
    const result = scheduleOfficialPlanFromConfirmedPayment({ paidAt, months: 1 });
    assert.equal(result.state, 'active');
    assert.equal(result.paidAt, paidAt);
    assert.equal(result.startsAt, paidAt);
    assert.equal(result.expiresAt, expiresAt);
  }
});

test('canonical plan rejects invalid confirmation timestamps and terms', () => {
  assert.throws(() => scheduleOfficialPlanFromConfirmedPayment({ paidAt: 'not-a-date', months: 1 }), /INVALID_PAYMENT_DATE/);
  assert.throws(() => scheduleOfficialPlanFromConfirmedPayment({ paidAt: '2026-11-16T12:00:00.000Z', months: 2 as 1 }), /INVALID_TERM/);
});
