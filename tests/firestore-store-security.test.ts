import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { after, before, beforeEach, test } from 'node:test';
import {
  assertFails,
  assertSucceeds,
  initializeTestEnvironment,
  type RulesTestEnvironment,
} from '@firebase/rules-unit-testing';
import {
  doc,
  getDoc,
  serverTimestamp,
  setDoc,
  Timestamp,
  updateDoc,
} from 'firebase/firestore';

const PROJECT_ID = 'kyrub-security-test';
const STORE_ID = 'store-independent-a';

let environment: RulesTestEnvironment;

const storeRecord = (ownerId = 'owner-a') => ({
  id: STORE_ID,
  ownerId,
  name: 'Loja de teste',
  publicationStatus: 'paused',
  createdAt: Timestamp.fromMillis(1_700_000_000_000),
  updatedAt: Timestamp.fromMillis(1_700_000_000_000),
});

const memberRecord = (
  userId: string,
  role: 'manager' | 'cashier' | 'seller' | 'production',
  status: 'active' | 'invited' = 'active'
) => ({
  storeId: STORE_ID,
  userId,
  role,
  status,
  invitedBy: 'owner-a',
  invitedAt: Timestamp.fromMillis(1_700_000_000_000),
  acceptedAt:
    status === 'active' ? Timestamp.fromMillis(1_700_000_000_100) : '',
  suspendedAt: '',
  removedAt: '',
  createdAt: Timestamp.fromMillis(1_700_000_000_000),
  updatedAt: Timestamp.fromMillis(1_700_000_000_100),
});

const orderRecord = (
  orderId: string,
  buyerId: string,
  overrides: Record<string, unknown> = {}
) => ({
  id: orderId,
  storeId: STORE_ID,
  buyerId,
  buyerName: 'Cliente',
  buyerEmail: 'cliente@example.com',
  fulfillmentType: 'pickup',
  deliveryAddress: '',
  tableCode: '',
  customerNote: '',
  items: [
    {
      lineId: `${orderId}-line-1`,
      productId: 'product-a',
      name: 'Produto',
      price: 20,
      quantity: 1,
      paidQuantity: 0,
      transferredQuantity: 0,
      note: '',
      image: '',
      isService: false,
    },
  ],
  subtotal: 20,
  total: 20,
  status: 'pending',
  paymentStatus: 'unpaid',
  source: 'customer',
  createdByUserId: buyerId,
  createdByRole: 'customer',
  createdAt: Timestamp.fromMillis(1_700_000_000_000),
  updatedAt: Timestamp.fromMillis(1_700_000_000_000),
  ...overrides,
});

const seedStore = async (): Promise<void> => {
  await environment.withSecurityRulesDisabled(async context => {
    const database = context.firestore();
    await setDoc(doc(database, 'stores', STORE_ID), storeRecord());
    await Promise.all([
      setDoc(
        doc(database, 'stores', STORE_ID, 'members', 'manager-a'),
        memberRecord('manager-a', 'manager')
      ),
      setDoc(
        doc(database, 'stores', STORE_ID, 'members', 'seller-a'),
        memberRecord('seller-a', 'seller')
      ),
      setDoc(
        doc(database, 'stores', STORE_ID, 'members', 'seller-b'),
        memberRecord('seller-b', 'seller')
      ),
      setDoc(
        doc(database, 'stores', STORE_ID, 'members', 'production-a'),
        memberRecord('production-a', 'production')
      ),
    ]);
  });
};

before(async () => {
  environment = await initializeTestEnvironment({
    projectId: PROJECT_ID,
    firestore: {
      rules: readFileSync('firestore.store-security.rules', 'utf8'),
      host: '127.0.0.1',
      port: 8088,
    },
  });
});

beforeEach(async () => {
  await environment.clearFirestore();
});

after(async () => {
  await environment.cleanup();
});

test('owner creates a store with an id independent from the Google uid', async () => {
  const owner = environment.authenticatedContext('owner-a').firestore();

  await assertSucceeds(
    setDoc(doc(owner, 'stores', STORE_ID), {
      id: STORE_ID,
      ownerId: 'owner-a',
      name: 'Loja',
      publicationStatus: 'paused',
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    })
  );

  await assertFails(
    setDoc(doc(owner, 'stores', 'owner-a'), {
      id: 'owner-a',
      ownerId: 'another-owner',
      name: 'Inválida',
      publicationStatus: 'paused',
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    })
  );
});

test('customer creates and reads only their own order', async () => {
  await seedStore();
  const customer = environment.authenticatedContext('buyer-a').firestore();
  const otherCustomer = environment.authenticatedContext('buyer-b').firestore();
  const orderReference = doc(customer, 'stores', STORE_ID, 'orders', 'order-a');

  await assertSucceeds(
    setDoc(orderReference, {
      ...orderRecord('order-a', 'buyer-a'),
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    })
  );
  await assertSucceeds(getDoc(orderReference));
  await assertFails(
    getDoc(doc(otherCustomer, 'stores', STORE_ID, 'orders', 'order-a'))
  );

  await assertFails(
    setDoc(doc(customer, 'stores', STORE_ID, 'orders', 'order-for-other'), {
      ...orderRecord('order-for-other', 'buyer-b'),
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    })
  );
});

test('manager invites lower roles but cannot create another manager', async () => {
  await seedStore();
  const manager = environment.authenticatedContext('manager-a').firestore();

  await assertSucceeds(
    setDoc(doc(manager, 'stores', STORE_ID, 'members', 'seller-new'), {
      storeId: STORE_ID,
      userId: 'seller-new',
      role: 'seller',
      status: 'invited',
      invitedBy: 'manager-a',
      invitedAt: serverTimestamp(),
      acceptedAt: '',
      suspendedAt: '',
      removedAt: '',
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    })
  );

  await assertFails(
    setDoc(doc(manager, 'stores', STORE_ID, 'members', 'manager-new'), {
      storeId: STORE_ID,
      userId: 'manager-new',
      role: 'manager',
      status: 'invited',
      invitedBy: 'manager-a',
      invitedAt: serverTimestamp(),
      acceptedAt: '',
      suspendedAt: '',
      removedAt: '',
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    })
  );
});

test('seller creates staff orders and payments while production cannot receive money', async () => {
  await seedStore();
  const seller = environment.authenticatedContext('seller-a').firestore();
  const production = environment.authenticatedContext('production-a').firestore();

  await assertSucceeds(
    setDoc(doc(seller, 'stores', STORE_ID, 'orders', 'staff-order-a'), {
      ...orderRecord('staff-order-a', 'walk-in-table-12', {
        buyerEmail: '',
        fulfillmentType: 'dine_in',
        tableCode: '12',
        status: 'accepted',
        source: 'staff',
        createdByUserId: 'seller-a',
        createdByRole: 'seller',
      }),
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    })
  );

  await assertSucceeds(
    setDoc(doc(seller, 'stores', STORE_ID, 'payments', 'payment-a'), {
      id: 'payment-a',
      storeId: STORE_ID,
      actorUserId: 'seller-a',
      actorRole: 'seller',
      amount: 20,
      method: 'cash',
      createdAt: serverTimestamp(),
    })
  );

  await assertFails(
    setDoc(doc(production, 'stores', STORE_ID, 'payments', 'payment-b'), {
      id: 'payment-b',
      storeId: STORE_ID,
      actorUserId: 'production-a',
      actorRole: 'production',
      amount: 20,
      method: 'cash',
      createdAt: serverTimestamp(),
    })
  );
});

test('seller reads only their own payment records', async () => {
  await seedStore();
  await environment.withSecurityRulesDisabled(async context => {
    const database = context.firestore();
    await Promise.all([
      setDoc(doc(database, 'stores', STORE_ID, 'payments', 'payment-a'), {
        id: 'payment-a',
        storeId: STORE_ID,
        actorUserId: 'seller-a',
        actorRole: 'seller',
        amount: 20,
        createdAt: Timestamp.now(),
      }),
      setDoc(doc(database, 'stores', STORE_ID, 'payments', 'payment-b'), {
        id: 'payment-b',
        storeId: STORE_ID,
        actorUserId: 'seller-b',
        actorRole: 'seller',
        amount: 30,
        createdAt: Timestamp.now(),
      }),
    ]);
  });

  const seller = environment.authenticatedContext('seller-a').firestore();
  await assertSucceeds(
    getDoc(doc(seller, 'stores', STORE_ID, 'payments', 'payment-a'))
  );
  await assertFails(
    getDoc(doc(seller, 'stores', STORE_ID, 'payments', 'payment-b'))
  );
});

test('production updates production state but cannot change payment state', async () => {
  await seedStore();
  await environment.withSecurityRulesDisabled(async context => {
    await setDoc(
      doc(context.firestore(), 'stores', STORE_ID, 'orders', 'order-production'),
      orderRecord('order-production', 'buyer-a', {
        status: 'accepted',
      })
    );
  });

  const production = environment.authenticatedContext('production-a').firestore();
  const reference = doc(
    production,
    'stores',
    STORE_ID,
    'orders',
    'order-production'
  );

  await assertSucceeds(
    updateDoc(reference, {
      status: 'preparing',
      updatedAt: serverTimestamp(),
    })
  );

  await assertFails(
    updateDoc(reference, {
      paymentStatus: 'paid',
      updatedAt: serverTimestamp(),
    })
  );

  const snapshot = await getDoc(reference);
  assert.equal(snapshot.data()?.status, 'preparing');
});
