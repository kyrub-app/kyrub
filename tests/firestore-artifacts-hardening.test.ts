import { readFileSync } from 'node:fs';
import { after, before, beforeEach, test } from 'node:test';
import {
  assertFails,
  assertSucceeds,
  initializeTestEnvironment,
  type RulesTestEnvironment,
} from '@firebase/rules-unit-testing';
import { doc, getDoc, setDoc, updateDoc } from 'firebase/firestore';

const PROJECT_ID = 'kyrub-security-test';
const STORE_ID = 'store-owner-a';
let environment: RulesTestEnvironment;

const customerOrder = (overrides: Record<string, unknown> = {}) => ({
  id: 'customer-order-a',
  storeId: STORE_ID,
  buyerId: 'buyer-a',
  buyerName: 'Cliente A',
  buyerEmail: 'buyer@example.com',
  fulfillmentType: 'dine_in',
  deliveryAddress: '',
  tableCode: '12',
  customerNote: '',
  items: [{
    lineId: 'line-a',
    productId: 'product-a',
    name: 'Produto A',
    price: 20,
    quantity: 1,
    paidQuantity: 0,
    transferredQuantity: 0,
    note: '',
    image: '',
    isService: false,
  }],
  subtotal: 20,
  total: 20,
  status: 'pending',
  paymentStatus: 'unpaid',
  source: 'customer',
  operatorId: '',
  operatorName: '',
  createdAt: '2026-08-21T19:00:00.000Z',
  updatedAt: '2026-08-21T19:00:00.000Z',
  ...overrides,
});

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
});

after(async () => {
  await environment.cleanup();
});

test('tenant owner keeps legacy artifact read/write access only inside own tenant', async () => {
  const owner = environment.authenticatedContext(STORE_ID).firestore();
  const ownReference = doc(
    owner,
    'artifacts', STORE_ID, 'private', 'data', 'note', 'note-a'
  );

  await assertSucceeds(setDoc(ownReference, { value: 'owner data' }));
  await assertSucceeds(getDoc(ownReference));
  await assertFails(
    setDoc(doc(owner, 'artifacts', 'another-owner', 'private', 'data', 'note', 'note-a'), {
      value: 'cross tenant write',
    })
  );
  await assertFails(
    getDoc(doc(owner, 'artifacts', 'another-owner', 'private', 'data', 'note', 'note-a'))
  );
});

test('signed-in stranger cannot read or mutate arbitrary artifact paths in another tenant', async () => {
  await environment.withSecurityRulesDisabled(async context => {
    await setDoc(
      doc(
        context.firestore(),
        'artifacts', STORE_ID, 'private', 'data', 'inventory', 'item-a'
      ),
      { stock: 12 }
    );
  });

  const stranger = environment.authenticatedContext('stranger-a').firestore();
  const reference = doc(
    stranger,
    'artifacts', STORE_ID, 'private', 'data', 'inventory', 'item-a'
  );

  await assertFails(getDoc(reference));
  await assertFails(setDoc(reference, { stock: 999 }));
});

test('buyer can create only an unpaid pending dine-in customer order', async () => {
  const buyer = environment.authenticatedContext('buyer-a').firestore();
  const validReference = doc(
    buyer,
    'artifacts', STORE_ID, 'public', 'data', 'customerOrders', 'customer-order-a'
  );
  await assertSucceeds(setDoc(validReference, customerOrder()));
  await assertFails(
    setDoc(
      doc(buyer, 'artifacts', STORE_ID, 'public', 'data', 'customerOrders', 'customer-order-delivery'),
      customerOrder({ id: 'customer-order-delivery', fulfillmentType: 'delivery' })
    )
  );
  await assertFails(
    setDoc(
      doc(buyer, 'artifacts', STORE_ID, 'public', 'data', 'customerOrders', 'customer-order-paid'),
      customerOrder({ id: 'customer-order-paid', paymentStatus: 'paid' })
    )
  );
});

test('buyer reads only their own legacy customer order across tenant boundary', async () => {
  await environment.withSecurityRulesDisabled(async context => {
    await setDoc(
      doc(
        context.firestore(),
        'artifacts', STORE_ID, 'public', 'data', 'customerOrders', 'customer-order-a'
      ),
      customerOrder()
    );
  });

  const owner = environment.authenticatedContext(STORE_ID).firestore();
  const buyer = environment.authenticatedContext('buyer-a').firestore();
  const otherBuyer = environment.authenticatedContext('buyer-b').firestore();

  await assertSucceeds(
    getDoc(doc(owner, 'artifacts', STORE_ID, 'public', 'data', 'customerOrders', 'customer-order-a'))
  );
  await assertSucceeds(
    getDoc(doc(buyer, 'artifacts', STORE_ID, 'public', 'data', 'customerOrders', 'customer-order-a'))
  );
  await assertFails(
    getDoc(doc(otherBuyer, 'artifacts', STORE_ID, 'public', 'data', 'customerOrders', 'customer-order-a'))
  );
});

test('buyer may cancel own pending dine-in order but cannot mutate financial state', async () => {
  const buyer = environment.authenticatedContext('buyer-a').firestore();
  const reference = doc(
    buyer,
    'artifacts', STORE_ID, 'public', 'data', 'customerOrders', 'customer-order-a'
  );
  await assertSucceeds(setDoc(reference, customerOrder()));
  await assertSucceeds(updateDoc(reference, {
    status: 'cancelled',
    updatedAt: '2026-08-21T19:01:00.000Z',
  }));
  await assertFails(updateDoc(reference, {
    paymentStatus: 'paid',
    updatedAt: '2026-08-21T19:02:00.000Z',
  }));
});
