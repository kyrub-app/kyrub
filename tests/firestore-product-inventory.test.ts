import { readFileSync } from 'node:fs';
import { after, before, beforeEach, test } from 'node:test';
import {
  assertFails,
  assertSucceeds,
  initializeTestEnvironment,
  type RulesTestEnvironment,
} from '@firebase/rules-unit-testing';
import {
  collection,
  deleteDoc,
  doc,
  getDoc,
  getDocs,
  serverTimestamp,
  setDoc,
  updateDoc,
} from 'firebase/firestore';

const PROJECT_ID = 'kyrub-security-test';
const OWNER_ID = 'inventory-owner';
const INVENTORY_PATH = `users/${OWNER_ID}/private_store/inventory`;
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
});

after(async () => {
  await environment.cleanup();
});

const inventoryPayload = () => ({
  ownerId: OWNER_ID,
  inventoryCatalog: [
    {
      id: 'flour',
      name: 'Farinha',
      unit: 'kg',
      currentQuantity: 10,
      minimumQuantity: 3,
      purchaseCost: 8,
      supplier: '',
      updatedAt: '2026-07-28T00:00:00.000Z',
    },
  ],
  productCompositions: {
    pizza: {
      kind: 'recipe',
      yieldQuantity: 1,
      lines: [{ inventoryItemId: 'flour', quantity: 0.3 }],
      updatedAt: '2026-07-28T00:00:00.000Z',
    },
  },
  createdAt: serverTimestamp(),
  updatedAt: serverTimestamp(),
});

test('owner creates and reads the private inventory document', async () => {
  const owner = environment.authenticatedContext(OWNER_ID).firestore();
  await assertSucceeds(setDoc(doc(owner, INVENTORY_PATH), inventoryPayload()));
  await assertSucceeds(getDoc(doc(owner, INVENTORY_PATH)));
});

test('another authenticated user cannot read or change the inventory', async () => {
  await environment.withSecurityRulesDisabled(async context => {
    await setDoc(doc(context.firestore(), INVENTORY_PATH), {
      ...inventoryPayload(),
      createdAt: new Date('2026-07-28T00:00:00.000Z'),
      updatedAt: new Date('2026-07-28T00:00:00.000Z'),
    });
  });

  const other = environment.authenticatedContext('other-user').firestore();
  await assertFails(getDoc(doc(other, INVENTORY_PATH)));
  await assertFails(
    updateDoc(doc(other, INVENTORY_PATH), {
      inventoryCatalog: [],
      updatedAt: serverTimestamp(),
    })
  );
});

test('owner updates operational values but cannot replace immutable ownership', async () => {
  const owner = environment.authenticatedContext(OWNER_ID).firestore();
  await assertSucceeds(setDoc(doc(owner, INVENTORY_PATH), inventoryPayload()));
  await assertSucceeds(
    updateDoc(doc(owner, INVENTORY_PATH), {
      inventoryCatalog: [],
      productCompositions: {},
      updatedAt: serverTimestamp(),
    })
  );
  await assertFails(
    updateDoc(doc(owner, INVENTORY_PATH), {
      ownerId: 'other-user',
      updatedAt: serverTimestamp(),
    })
  );
});

test('inventory cannot be listed, deleted or read without authentication', async () => {
  await environment.withSecurityRulesDisabled(async context => {
    await setDoc(doc(context.firestore(), INVENTORY_PATH), {
      ...inventoryPayload(),
      createdAt: new Date('2026-07-28T00:00:00.000Z'),
      updatedAt: new Date('2026-07-28T00:00:00.000Z'),
    });
  });

  const owner = environment.authenticatedContext(OWNER_ID).firestore();
  const visitor = environment.unauthenticatedContext().firestore();
  await assertFails(
    getDocs(collection(owner, `users/${OWNER_ID}/private_store`))
  );
  await assertFails(deleteDoc(doc(owner, INVENTORY_PATH)));
  await assertFails(getDoc(doc(visitor, INVENTORY_PATH)));
});
