import assert from 'node:assert/strict';
import test from 'node:test';
import {
  scheduleOfficialPlanAfterPayment,
  scheduleOfficialPlanFromConfirmedPayment,
  activatePaidOfficialPlan,
  officialPlanPaymentEffects,
} from '../server/payments/officialPlanActivationSchedule';

const paidAt = '2026-11-09T12:00:00.000Z';
const activatedAt = '2026-11-15T12:00:00.000Z';

test('payment before first store activation does not consume paid term or grant access', () => {
  const pending = scheduleOfficialPlanAfterPayment({
    paidAt, buyerStoreActivatedAt: null, months: 3,
  });
  assert.equal(pending.state, 'paid_pending_activation');
  assert.equal(pending.startsAt, null);
  assert.equal(pending.expiresAt, null);
  assert.deepEqual(officialPlanPaymentEffects(pending), {
    recordPayment: true, grantEntitlement: false, writePlanMirrors: false,
    reconcileBenefitCycle: false, checkoutStatus: 'paid_pending_activation',
  });
  const active = activatePaidOfficialPlan({ schedule: pending, activatedAt, months: 3 });
  assert.equal(active.startsAt, activatedAt);
  assert.equal(active.expiresAt, '2027-02-15T12:00:00.000Z');
  assert.equal(activatePaidOfficialPlan({
    schedule: active, activatedAt: '2026-11-20T12:00:00.000Z', months: 3,
  }).startsAt, activatedAt);
});

test('activation already completed before payment starts the term on payment confirmation', () => {
  const active = scheduleOfficialPlanAfterPayment({
    paidAt, buyerStoreActivatedAt: '2026-11-01T12:00:00.000Z', months: 1,
  });
  assert.equal(active.state, 'active');
  assert.equal(active.startsAt, paidAt);
  assert.equal(active.expiresAt, '2026-12-09T12:00:00.000Z');
  assert.equal(officialPlanPaymentEffects(active).grantEntitlement, true);
});

test('a pending plan rejects an activation timestamp earlier than payment', () => {
  const pending = scheduleOfficialPlanAfterPayment({
    paidAt, buyerStoreActivatedAt: null, months: 1,
  });
  assert.throws(() => activatePaidOfficialPlan({
    schedule: pending, activatedAt: '2026-11-08T12:00:00.000Z', months: 1,
  }), /OFFICIAL_PLAN_INVALID_ACTIVATION_DATE/);
});

test('launch policy starts Pro or Business at approved Pix payment, with no store', () => {
  for (const months of [1, 3, 6, 12] as const) {
    const active = scheduleOfficialPlanFromConfirmedPayment({ paidAt, months });
    assert.equal(active.state, 'active');
    assert.equal(active.startsAt, paidAt);
    assert.equal(active.paidAt, paidAt);
    assert.ok(active.expiresAt && Date.parse(active.expiresAt) > Date.parse(paidAt));
    assert.deepEqual(officialPlanPaymentEffects(active), {
      recordPayment: true, grantEntitlement: true, writePlanMirrors: true,
      reconcileBenefitCycle: true, checkoutStatus: 'activated',
    });
  }
});

test('launch policy is deterministic and cannot start from invalid payment data', () => {
  assert.deepEqual(
    scheduleOfficialPlanFromConfirmedPayment({ paidAt, months: 3 }),
    scheduleOfficialPlanFromConfirmedPayment({ paidAt, months: 3 }),
  );
  assert.throws(() => scheduleOfficialPlanFromConfirmedPayment({
    paidAt: 'invalid', months: 1,
  }), /OFFICIAL_PLAN_INVALID_PAYMENT_DATE/);
  assert.throws(() => scheduleOfficialPlanFromConfirmedPayment({
    paidAt, months: 2 as 1,
  }), /OFFICIAL_PLAN_INVALID_TERM/);
});
