import assert from 'node:assert/strict';
import { test } from 'node:test';
import { decideReservationCompletion } from '../server/admin/planReservationDecision.js';

test('checkout reserves pending preapproval once', () => {
  assert.equal(decideReservationCompletion('ref-a', 'mp-a', {
    billingReference: 'ref-a', checkoutReservationStatus: 'pending',
  }), 'write');
});

test('simultaneous matching webhook and checkout completions are idempotent', async () => {
  const state = { billingReference: 'ref-a', checkoutReservationStatus: 'pending', providerSubscriptionId: '' };
  const attempts = await Promise.all(Array.from({ length: 12 }, async () => {
    await Promise.resolve();
    const decision = decideReservationCompletion('ref-a', 'mp-a', state);
    if (decision === 'write') {
      state.checkoutReservationStatus = 'completed';
      state.providerSubscriptionId = 'mp-a';
    }
    return decision;
  }));
  assert.equal(attempts.filter(value => value === 'write').length, 1);
  assert.equal(attempts.filter(value => value === 'already-completed').length, 11);
});

test('different provider or billing reference never reuses completed reservation', () => {
  const completed = { billingReference: 'ref-a', checkoutReservationStatus: 'completed', providerSubscriptionId: 'mp-a' };
  assert.equal(decideReservationCompletion('ref-a', 'mp-b', completed), 'conflict');
  assert.equal(decideReservationCompletion('ref-b', 'mp-a', completed), 'conflict');
  assert.equal(decideReservationCompletion('ref-a', 'mp-a', completed), 'already-completed');
});

test('cancelled or missing reservation cannot be completed', () => {
  assert.equal(decideReservationCompletion('ref-a', 'mp-a', {}), 'conflict');
  assert.equal(decideReservationCompletion('ref-a', 'mp-a', {
    billingReference: 'ref-a', checkoutReservationStatus: 'cancelled',
  }), 'conflict');
});
