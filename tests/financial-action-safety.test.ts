import assert from 'node:assert/strict';
import test from 'node:test';
import {
  evaluateFinancialAction,
  KYRUB_FINANCIAL_ACTION_POLICY,
} from '../server/payments/financialActionPolicy';

const valid = {
  idempotencyKey: 'idem-1',
  correlationId: 'corr-1',
  authoritativeStateConfirmed: true,
} as const;

test('financial actions never allow autonomous execution', () => {
  for (const action of Object.keys(KYRUB_FINANCIAL_ACTION_POLICY) as Array<keyof typeof KYRUB_FINANCIAL_ACTION_POLICY>) {
    assert.equal(KYRUB_FINANCIAL_ACTION_POLICY[action].autonomousExecution, false);
    assert.equal(evaluateFinancialAction({ action, authority: 'user_confirmation', autonomous: true, ...valid }).allowed, false);
  }
});

test('payment approval can only come from authoritative provider or reconciliation evidence', () => {
  assert.deepEqual(
    evaluateFinancialAction({ action: 'confirm_payment', authority: 'user_confirmation', ...valid }),
    { allowed: false, reason: 'AUTHORITY_NOT_ALLOWED' }
  );
  assert.equal(
    evaluateFinancialAction({ action: 'confirm_payment', authority: 'provider_webhook', ...valid }).allowed,
    true
  );
});

test('financial mutations require idempotency, correlation and authoritative state', () => {
  assert.equal(
    evaluateFinancialAction({ action: 'refund_payment', authority: 'user_confirmation', correlationId: 'corr', authoritativeStateConfirmed: true }).reason,
    'IDEMPOTENCY_REQUIRED'
  );
  assert.equal(
    evaluateFinancialAction({ action: 'refund_payment', authority: 'user_confirmation', idempotencyKey: 'idem', authoritativeStateConfirmed: true }).reason,
    'CORRELATION_REQUIRED'
  );
  assert.equal(
    evaluateFinancialAction({ action: 'refund_payment', authority: 'user_confirmation', idempotencyKey: 'idem', correlationId: 'corr' }).reason,
    'AUTHORITATIVE_STATE_REQUIRED'
  );
});

test('split, recipient changes and pix transfers are critical', () => {
  for (const action of ['create_split', 'change_recipient', 'pix_transfer'] as const) {
    assert.equal(KYRUB_FINANCIAL_ACTION_POLICY[action].risk, 'critical');
  }
});
