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

const fiscalProfile = () => ({
  enabled: true,
  kind: 'goods',
  fiscalDescription: 'Refrigerante lata 350 ml',
  ncm: '22021000',
  cest: '0300700',
  gtin: '7894900011517',
  noGtin: false,
  commercialUnit: 'UN',
  taxUnit: 'UN',
  conversionFactor: 1,
  origin: '0',
  serviceListCode: '',
  municipalServiceCode: '',
  nbs: '',
  updatedAt: '2026-08-01T00:00:00.000Z',
});

test('owner creates and reads the private inventory document', async () => {
  const owner = environment.authenticatedContext(OWNER_ID).firestore();
  await assertSucceeds(setDoc(doc(owner, INVENTORY_PATH), inventoryPayload()));
  await assertSucceeds(getDoc(doc(owner, INVENTORY_PATH)));
});

test('owner stores and updates private fiscal profiles beside inventory data', async () => {
  const owner = environment.authenticatedContext(OWNER_ID).firestore();
  await assertSucceeds(
    setDoc(doc(owner, INVENTORY_PATH), {
      ...inventoryPayload(),
      productFiscalProfiles: {
        'product-1': fiscalProfile(),
      },
    })
  );
  await assertSucceeds(
    updateDoc(doc(owner, INVENTORY_PATH), {
      productFiscalProfiles: {
        'product-1': {
          ...fiscalProfile(),
          noGtin: true,
          gtin: '',
        },
      },
      updatedAt: serverTimestamp(),
    })
  );
});

test('another authenticated user cannot read or change inventory or fiscal profiles', async () => {
  await environment.withSecurityRulesDisabled(async context => {
    await setDoc(doc(context.firestore(), INVENTORY_PATH), {
      ...inventoryPayload(),
      productFiscalProfiles: { 'product-1': fiscalProfile() },
      createdAt: new Date('2026-07-28T00:00:00.000Z'),
      updatedAt: new Date('2026-07-28T00:00:00.000Z'),
    });
  });

  const other = environment.authenticatedContext('other-user').firestore();
  await assertFails(getDoc(doc(other, INVENTORY_PATH)));
  await assertFails(
    updateDoc(doc(other, INVENTORY_PATH), {
      inventoryCatalog: [],
      productFiscalProfiles: {},
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

test('private inventory rejects undeclared top-level data', async () => {
  const owner = environment.authenticatedContext(OWNER_ID).firestore();
  await assertFails(
    setDoc(doc(owner, INVENTORY_PATH), {
      ...inventoryPayload(),
      publicTaxRates: { icms: 18 },
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
