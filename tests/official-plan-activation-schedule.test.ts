import assert from 'node:assert/strict';
import { test } from 'node:test';
import { activatePaidOfficialPlan, officialPixStatusAfterProviderBind, resolveOfficialPlanBuyerStore, scheduleOfficialPlanAfterPayment } from '../server/payments/officialPlanActivationSchedule.js';

test('paid buyer without a store does not lose ten days before activation', () => {
  const paid = scheduleOfficialPlanAfterPayment({
    paidAt: '2026-11-08T12:00:00.000Z', buyerStoreActivatedAt: null, months: 1,
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
    paidAt: '2026-11-08T12:00:00.000Z', buyerStoreActivatedAt: '2026-11-01T12:00:00.000Z', months: 3,
  });
  assert.equal(paid.state, 'active');
  assert.equal(paid.startsAt, '2026-11-08T12:00:00.000Z');
  assert.equal(paid.expiresAt, '2027-02-08T12:00:00.000Z');
});

test('activation rejects a date before payment and malformed pending state', () => {
  const paid = scheduleOfficialPlanAfterPayment({
    paidAt: '2026-11-08T12:00:00.000Z', buyerStoreActivatedAt: null, months: 1,
  });
  assert.throws(() => activatePaidOfficialPlan({
    schedule: paid, activatedAt: '2026-11-07T12:00:00.000Z', months: 1,
  }), /OFFICIAL_PLAN_INVALID_ACTIVATION_DATE/);
  assert.throws(() => activatePaidOfficialPlan({
    schedule: { ...paid, startsAt: '2026-11-08T12:00:00.000Z' },
    activatedAt: '2026-11-09T12:00:00.000Z', months: 1,
  }), /OFFICIAL_PLAN_INVALID_PENDING_TERM/);
});

test('a legacy Free record does not imply store activation, and future activation stays pending', () => {
  const pending = scheduleOfficialPlanAfterPayment({
    paidAt: '2026-11-08T12:00:00.000Z',
    buyerStoreActivatedAt: '2026-11-18T12:00:00.000Z', months: 1,
  });
  assert.equal(pending.state, 'paid_pending_activation');
  assert.equal(pending.startsAt, null);
  assert.throws(() => scheduleOfficialPlanAfterPayment({
    paidAt: '2026-11-08T12:00:00.000Z',
    buyerStoreActivatedAt: 'invalid', months: 1,
  }), /OFFICIAL_PLAN_INVALID_STORE_ACTIVATION_DATE/);
});

test('a twelve-month prepaid term starts on activation, not on payment', () => {
  const pending = scheduleOfficialPlanAfterPayment({
    paidAt: '2026-11-09T10:00:00.000Z', buyerStoreActivatedAt: null, months: 12,
  });
  const active = activatePaidOfficialPlan({
    schedule: pending, activatedAt: '2026-12-09T10:00:00.000Z', months: 12,
  });
  assert.equal(active.expiresAt, '2027-12-09T10:00:00.000Z');
  assert.equal(active.paidAt, '2026-11-09T10:00:00.000Z');
});

test('activation exactly at payment confirmation is valid', () => {
  const paidAt = '2026-11-09T10:00:00.000Z';
  const active = scheduleOfficialPlanAfterPayment({
    paidAt, buyerStoreActivatedAt: paidAt, months: 1,
  });
  assert.equal(active.state, 'active');
  assert.equal(active.startsAt, paidAt);
});

test('provider retries never downgrade paid or activated checkouts', () => {
  assert.equal(officialPixStatusAfterProviderBind('paid_pending_activation'), 'paid_pending_activation');
  assert.equal(officialPixStatusAfterProviderBind('activated'), 'activated');
  assert.equal(officialPixStatusAfterProviderBind('in_flight'), 'bound');
});

test('buyer with no canonical store may quote before activating a store', () => {
  assert.deepEqual(resolveOfficialPlanBuyerStore({
    canonicalStoreIds: [], hasLegacyStore: true,
  }), { buyerStoreId: null, buyerStoreProvisioningRequired: true });
  assert.deepEqual(resolveOfficialPlanBuyerStore({
    canonicalStoreIds: [], hasLegacyStore: false,
  }), { buyerStoreId: null, buyerStoreProvisioningRequired: true });
});

test('existing store is reused; conflicting store identity is rejected', () => {
  assert.deepEqual(resolveOfficialPlanBuyerStore({
    canonicalStoreIds: ['store_valid'], hasLegacyStore: true,
  }), { buyerStoreId: 'store_valid', buyerStoreProvisioningRequired: false });
  assert.throws(() => resolveOfficialPlanBuyerStore({
    canonicalStoreIds: ['store_a', 'store_b'], hasLegacyStore: true,
  }), /OFFICIAL_PIX_BUYER_STORE_IDENTITY_CONFLICT/);
  assert.throws(() => resolveOfficialPlanBuyerStore({
    canonicalStoreIds: ['store_a'], hasLegacyStore: false,
  }), /OFFICIAL_PIX_BUYER_STORE_IDENTITY_CONFLICT/);
});
