import assert from 'node:assert/strict';
import { test } from 'node:test';
import { decideReservationCompletion } from '../server/admin/planReservationDecision.js';

test('checkout reserves pending preapproval once', () => {
  assert.equal(decideReservationCompletion('ref-a', 'mp-a', {
    billingReference: 'ref-a', checkoutReservationStatus: 'pending',
  }), 'write');
});

// Minimal optimistic-transaction simulator: every contender reads a snapshot,
// then a version check forces losers to retry against the committed state.
// This exercises the same decision inside the retry boundary as Firestore.
type Reservation = {
  billingReference: string;
  checkoutReservationStatus: string;
  providerSubscriptionId: string;
};
const makeTransactionalReservation = (initial: Reservation) => {
  let current = { ...initial };
  let version = 0;
  let writes = 0;
  const transact = async (reference: string, providerId: string) => {
    for (let retry = 0; retry < 30; retry++) {
      const observed = { ...current };
      const observedVersion = version;
      const decision = decideReservationCompletion(reference, providerId, observed);
      await Promise.resolve(); // allow competing transactions to read the same version
      if (observedVersion !== version) continue;
      if (decision === 'write') {
        current = { ...observed, checkoutReservationStatus: 'completed', providerSubscriptionId: providerId };
        version++;
        writes++;
      }
      return decision;
    }
    throw new Error('transaction retries exhausted');
  };
  return { transact, snapshot: () => ({ ...current }), writes: () => writes };
};

test('concurrent checkout and webhook completions commit exactly once after transaction retries', async () => {
  const db = makeTransactionalReservation({
    billingReference: 'ref-a', checkoutReservationStatus: 'pending', providerSubscriptionId: '',
  });
  const results = await Promise.all(Array.from({ length: 12 }, () => db.transact('ref-a', 'mp-a')));
  assert.equal(results.filter(value => value === 'write').length, 1);
  assert.equal(results.filter(value => value === 'already-completed').length, 11);
  assert.equal(db.writes(), 1);
  assert.equal(db.snapshot().providerSubscriptionId, 'mp-a');
});

test('conflicting provider completions cannot overwrite the winning transaction', async () => {
  const db = makeTransactionalReservation({
    billingReference: 'ref-a', checkoutReservationStatus: 'pending', providerSubscriptionId: '',
  });
  const results = await Promise.all([db.transact('ref-a', 'mp-a'), db.transact('ref-a', 'mp-b')]);
  assert.deepEqual(results.slice().sort(), ['conflict', 'write']);
  assert.equal(db.writes(), 1);
  assert.ok(['mp-a', 'mp-b'].includes(db.snapshot().providerSubscriptionId));
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
