import assert from 'node:assert/strict';
import { test } from 'node:test';
import { activatePaidOfficialPlan, scheduleOfficialPlanAfterPayment } from '../server/payments/officialPlanActivationSchedule.js';

test('paid buyer without a store does not lose ten days before activation', () => {
  const paid = scheduleOfficialPlanAfterPayment({
    paidAt: '2026-11-08T12:00:00.000Z', buyerStoreActivated: false, months: 1,
  });
  assert.deepEqual(paid, {
    state: 'paid_pending_activation', paidAt: '2026-11-08T12:00:00.000Z',
    startsAt: null, expiresAt: null,
  });
  const active = activatePaidOfficialPlan({
    schedule: paid, activatedAt: '2026-11-18T12:00:00.000Z', months: 1,
  });
  assert.equal(active.startsAt, '2026-11-18T12:00:00.000Z');
  assert.equal(active.expiresAt, '2026-12-18T12:00:00.000Z');
  assert.deepEqual(activatePaidOfficialPlan({
    schedule: active, activatedAt: '2026-11-25T12:00:00.000Z', months: 1,
  }), active);
});

test('existing active store begins its subscription on payment approval', () => {
  const paid = scheduleOfficialPlanAfterPayment({
    paidAt: '2026-11-08T12:00:00.000Z', buyerStoreActivated: true, months: 3,
  });
  assert.equal(paid.state, 'active');
  assert.equal(paid.startsAt, '2026-11-08T12:00:00.000Z');
  assert.equal(paid.expiresAt, '2027-02-08T12:00:00.000Z');
});

test('activation rejects a date before payment and malformed pending state', () => {
  const paid = scheduleOfficialPlanAfterPayment({
    paidAt: '2026-11-08T12:00:00.000Z', buyerStoreActivated: false, months: 1,
  });
  assert.throws(() => activatePaidOfficialPlan({
    schedule: paid, activatedAt: '2026-11-07T12:00:00.000Z', months: 1,
  }), /OFFICIAL_PLAN_INVALID_ACTIVATION_DATE/);
  assert.throws(() => activatePaidOfficialPlan({
    schedule: { ...paid, startsAt: '2026-11-08T12:00:00.000Z' },
    activatedAt: '2026-11-09T12:00:00.000Z', months: 1,
  }), /OFFICIAL_PLAN_INVALID_PENDING_TERM/);
});
