import { readFileSync } from 'node:fs';
import { after, before, beforeEach, test } from 'node:test';
import {
  assertFails,
  assertSucceeds,
  initializeTestEnvironment,
  type RulesTestEnvironment,
} from '@firebase/rules-unit-testing';
import {
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
      rules: readFileSync('.firebase/firestore.combined.rules', 'utf8'),
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

test('authenticated users may read delivery opportunities', async () => {
  const courier = environment.authenticatedContext('courier-a').firestore();
  await assertSucceeds(getDoc(doc(courier, DELIVERY_PATH)));
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
