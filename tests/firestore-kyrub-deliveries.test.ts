import assert from 'node:assert/strict';
import { subscribeAuthorizedDeliveryBoard } from '../src/utils/deliveryBoardSubscription';
import { readFileSync } from 'node:fs';
import { after, before, beforeEach, test } from 'node:test';
import {
  assertFails,
  assertSucceeds,
  initializeTestEnvironment,
  type RulesTestEnvironment,
} from '@firebase/rules-unit-testing';
import {
  collection, getDocs, query, where, or, type Firestore,
  deleteDoc,
  doc,
  getDoc,
  serverTimestamp,
  setDoc,
  updateDoc,
} from 'firebase/firestore';

const PROJECT_ID = 'kyrub-security-test';
const DELIVERY_ID = 'order-secure-delivery';
const DELIVERY_PATH = `hub/renda/deliveries/${DELIVERY_ID}`;
let environment: RulesTestEnvironment;

before(async () => {
  environment = await initializeTestEnvironment({
    projectId: PROJECT_ID,
    firestore: {
      rules: readFileSync(process.env.TEST_RULES_PATH || '.firebase/firestore.combined.rules', 'utf8'),
      host: '127.0.0.1',
      port: 8088,
    },
  });
});

beforeEach(async () => {
  await environment.clearFirestore();
  await environment.withSecurityRulesDisabled(async context => {
    await setDoc(doc(context.firestore(), DELIVERY_PATH), {
      id: DELIVERY_ID,
      source: 'kyrub-order',
      sourceOrderId: 'order-1',
      storeId: 'store-a',
      from: 'Loja A',
      to: 'Rua A, 10',
      distance: 3,
      payment: 12,
      status: 'available',
      requestedBy: 'store-a',
      acceptedBy: '',
      fallbackStatus: 'waiting_kyrub',
      createdAt: new Date('2026-07-27T12:00:00.000Z'),
      updatedAt: new Date('2026-07-27T12:00:00.000Z'),
    });
  });
});

after(async () => {
  await environment.cleanup();
});

test('unapproved strangers cannot read delivery opportunities', async () => {
  const courier = environment.authenticatedContext('courier-a').firestore();
  await assertFails(getDoc(doc(courier, DELIVERY_PATH)));
});

test('unauthenticated visitors cannot read delivery opportunities', async () => {
  const visitor = environment.unauthenticatedContext().firestore();
  await assertFails(getDoc(doc(visitor, DELIVERY_PATH)));
});

test('clients cannot create canonical delivery opportunities', async () => {
  const user = environment.authenticatedContext('store-a').firestore();
  await assertFails(
    setDoc(doc(user, 'hub/renda/deliveries/order-client-created'), {
      id: 'order-client-created',
      source: 'kyrub-order',
      status: 'available',
      requestedBy: 'store-a',
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    })
  );
});

test('clients cannot claim or complete a delivery directly', async () => {
  const courier = environment.authenticatedContext('courier-a').firestore();
  const reference = doc(courier, DELIVERY_PATH);

  await assertFails(
    updateDoc(reference, {
      status: 'accepted',
      acceptedBy: 'courier-a',
      updatedAt: serverTimestamp(),
    })
  );
  await assertFails(
    updateDoc(reference, {
      status: 'done',
      updatedAt: serverTimestamp(),
    })
  );
});

test('clients cannot delete delivery opportunities', async () => {
  const store = environment.authenticatedContext('store-a').firestore();
  await assertFails(deleteDoc(doc(store, DELIVERY_PATH)));
});

async function approveCourier(uid: string, status = 'approved') {
  await environment.withSecurityRulesDisabled(async context => {
    await setDoc(doc(context.firestore(), 'identity_verifications', uid), {
      status, approvedProfiles: ['bicycle_courier'],
    });
  });
}

test('approved couriers can query available deliveries but not unscoped or assigned deliveries', async () => {
  await approveCourier('courier-a');
  const db = environment.authenticatedContext('courier-a').firestore();
  await assertSucceeds(getDocs(query(collection(db, 'hub/renda/deliveries'), where('status', '==', 'available'))));
  await assertFails(getDocs(collection(db, 'hub/renda/deliveries')));
  await environment.withSecurityRulesDisabled(async context => {
    await updateDoc(doc(context.firestore(), DELIVERY_PATH), { status: 'accepted', acceptedBy: 'other-courier', buyerId: 'buyer-a' });
  });
  await assertFails(getDoc(doc(db, DELIVERY_PATH)));
  for (const [uid, field] of [['store-a', 'storeId'], ['buyer-a', 'buyerId'], ['other-courier', 'acceptedBy']]) {
    const participant = environment.authenticatedContext(uid).firestore();
    await assertSucceeds(getDoc(doc(participant, DELIVERY_PATH)));
    await assertSucceeds(getDocs(query(collection(participant, 'hub/renda/deliveries'), where(field, '==', uid))));
  }
});

test('board OR query matches the actual client constraints and revocation removes available access', async () => {
  await approveCourier('courier-a');
  const db = environment.authenticatedContext('courier-a').firestore();
  const own = ['storeId', 'buyerId', 'acceptedBy'].map(field => where(field, '==', 'courier-a'));
  await assertSucceeds(getDocs(query(collection(db, 'hub/renda/deliveries'), or(...own, where('status', '==', 'available')))));
  await approveCourier('courier-a', 'rejected');
  await assertFails(getDoc(doc(db, DELIVERY_PATH)));
  await assertSucceeds(getDocs(query(collection(db, 'hub/renda/deliveries'), or(...own))));
});

test('live board subscription reacts to approval, revocation and cleanup', async () => {
  const db = environment.authenticatedContext('courier-a').firestore();
  let ids: string[] = [];
  let callbacks = 0;
  const errors: unknown[] = [];
  const waitFor = async (predicate: () => boolean) => {
    const deadline = Date.now() + 8000;
    while (!predicate() && Date.now() < deadline) await new Promise(resolve => setTimeout(resolve, 25));
    assert.ok(predicate(), 'expected live board state before timeout');
  };
  const stop = subscribeAuthorizedDeliveryBoard(db as unknown as Firestore, 'courier-a', snapshot => {
    ids = snapshot.docs.map(item => item.id); ++callbacks;
  }, error => errors.push(error), () => { ids = []; });
  try {
    await waitFor(() => callbacks > 0);
    assert.deepEqual(ids, []);
    await approveCourier('courier-a');
    await waitFor(() => ids.includes(DELIVERY_ID));
    await approveCourier('courier-a', 'rejected');
    await waitFor(() => ids.length === 0);
    assert.deepEqual(errors, []);
  } finally { stop(); }
  const previous = callbacks;
  await approveCourier('courier-a');
  await new Promise(resolve => setTimeout(resolve, 100));
  assert.equal(callbacks, previous);
});
