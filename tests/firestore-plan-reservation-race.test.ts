import assert from 'node:assert/strict';
import { before, after, beforeEach, test } from 'node:test';
import { initializeTestEnvironment, type RulesTestEnvironment } from '@firebase/rules-unit-testing';
import { doc, getDoc, runTransaction, setDoc } from 'firebase/firestore';
import { decideReservationCompletion } from '../server/admin/planReservationDecision.js';

const PROJECT_ID = 'kyrub-security-test';
let environment: RulesTestEnvironment;
const path = 'kyrub_plan_subscriptions/race_owner_a';

before(async () => {
  environment = await initializeTestEnvironment({
    projectId: PROJECT_ID,
    firestore: { host: '127.0.0.1', port: 8088 },
  });
});
after(async () => { await environment?.cleanup(); });
beforeEach(async () => { await environment.clearFirestore(); });

const complete = async (reference: string, providerId: string) =>
  environment.withSecurityRulesDisabled(async context => {
    const db = context.firestore();
    return runTransaction(db, async transaction => {
      const ref = doc(db, path);
      const snapshot = await transaction.get(ref);
      const decision = decideReservationCompletion(reference, providerId, snapshot.data() ?? {});
      if (decision === 'write') transaction.update(ref, {
        checkoutReservationStatus: 'completed',
        providerSubscriptionId: providerId,
      });
      return decision;
    });
  });

test('Firestore emulator retries concurrent matching webhook and checkout completions', async () => {
  await environment.withSecurityRulesDisabled(context => setDoc(doc(context.firestore(), path), {
    billingReference: 'ref-a', checkoutReservationStatus: 'pending', providerSubscriptionId: '',
  }));
  const results = await Promise.all(Array.from({ length: 8 }, () => complete('ref-a', 'mp-a')));
  assert.equal(results.filter(value => value === 'write').length, 1);
  assert.equal(results.filter(value => value === 'already-completed').length, 7);
  const saved = await environment.withSecurityRulesDisabled(context => getDoc(doc(context.firestore(), path)));
  assert.equal(saved.data()?.providerSubscriptionId, 'mp-a');
});

test('Firestore emulator prevents a conflicting provider from overwriting a completed reservation', async () => {
  await environment.withSecurityRulesDisabled(context => setDoc(doc(context.firestore(), path), {
    billingReference: 'ref-a', checkoutReservationStatus: 'pending', providerSubscriptionId: '',
  }));
  const results = await Promise.all([complete('ref-a', 'mp-a'), complete('ref-a', 'mp-b')]);
  assert.deepEqual(results.sort(), ['conflict', 'write']);
  const saved = await environment.withSecurityRulesDisabled(context => getDoc(doc(context.firestore(), path)));
  assert.ok(['mp-a', 'mp-b'].includes(saved.data()?.providerSubscriptionId));
});
