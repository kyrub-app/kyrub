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
const LEGACY_STORE_ID = 'owner-a';
let environment: RulesTestEnvironment;

const storeRecord = () => ({
  id: STORE_ID,
  ownerId: 'owner-a',
  name: 'Loja A',
  publicationStatus: 'paused',
  plan: 'free',
  legacyTenantId: LEGACY_STORE_ID,
  migrationStatus: 'dual_write',
  createdAt: Timestamp.fromMillis(1_700_000_000_000),
  updatedAt: Timestamp.fromMillis(1_700_000_000_000),
});

const managerMember = () => ({
  storeId: STORE_ID,
  storeName: 'Loja A',
  userId: 'manager-a',
  displayName: 'Gerente A',
  email: 'manager@example.com',
  photoUrl: '',
  role: 'manager',
  status: 'active',
  invitedBy: 'owner-a',
  invitedAt: Timestamp.fromMillis(1_700_000_000_000),
  acceptedAt: Timestamp.fromMillis(1_700_000_000_000),
  suspendedAt: '',
  removedAt: '',
  createdAt: Timestamp.fromMillis(1_700_000_000_000),
  updatedAt: Timestamp.fromMillis(1_700_000_000_000),
});

const mirroredProduct = () => ({
  id: 'product-a',
  storeId: STORE_ID,
  supplierId: STORE_ID,
  name: 'Produto A',
  description: 'Descrição real',
  price: 20,
  image: '',
  stock: 3,
  category: 'Geral',
  isService: false,
  publicationStatus: 'published',
  createdByUserId: 'owner-a',
  createdByRole: 'owner',
  updatedByUserId: 'owner-a',
  updatedByRole: 'owner',
  legacyStoreId: LEGACY_STORE_ID,
  legacyProductId: 'product-a',
  legacySupplierId: LEGACY_STORE_ID,
  legacyUpdatedAt: '2026-07-22T10:00:00.000Z',
  migratedFromPath: 'tenants/owner-a#publicProducts/product-a',
  archivedAt: '',
  migration: {
    mode: 'dual_write',
    migratedByUserId: 'owner-a',
    migratedByRole: 'owner',
  },
  createdAt: serverTimestamp(),
  updatedAt: serverTimestamp(),
});

const directManagerProduct = () => ({
  id: 'product-manager-a',
  storeId: STORE_ID,
  supplierId: STORE_ID,
  name: 'Produto do gerente',
  description: '',
  price: 15,
  image: '',
  stock: 1,
  category: 'Geral',
  isService: false,
  publicationStatus: 'draft',
  createdByUserId: 'manager-a',
  createdByRole: 'manager',
  updatedByUserId: 'manager-a',
  updatedByRole: 'manager',
  legacyStoreId: '',
  legacyProductId: '',
  legacySupplierId: '',
  legacyUpdatedAt: '',
  migratedFromPath: '',
  archivedAt: '',
  migration: {
    mode: 'canonical',
    migratedByUserId: '',
    migratedByRole: '',
  },
  createdAt: serverTimestamp(),
  updatedAt: serverTimestamp(),
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
  await environment.withSecurityRulesDisabled(async context => {
    const firestore = context.firestore();
    await setDoc(doc(firestore, 'stores', STORE_ID), storeRecord());
    await setDoc(
      doc(firestore, 'stores', STORE_ID, 'members', 'manager-a'),
      managerMember()
    );
  });
});

after(async () => {
  await environment.cleanup();
});

test('owner mirrors a legacy product and signed-in customers read published products', async () => {
  const owner = environment.authenticatedContext('owner-a').firestore();
  const buyer = environment.authenticatedContext('buyer-a').firestore();
  const anonymous = environment.unauthenticatedContext().firestore();
  const reference = doc(owner, 'stores', STORE_ID, 'products', 'product-a');

  await assertSucceeds(setDoc(reference, mirroredProduct()));
  await assertSucceeds(
    getDoc(doc(buyer, 'stores', STORE_ID, 'products', 'product-a'))
  );
  await assertFails(
    getDoc(doc(anonymous, 'stores', STORE_ID, 'products', 'product-a'))
  );
});

test('outsiders cannot create or alter canonical products', async () => {
  const stranger = environment.authenticatedContext('stranger-a').firestore();
  const owner = environment.authenticatedContext('owner-a').firestore();
  const reference = doc(owner, 'stores', STORE_ID, 'products', 'product-a');

  await assertFails(
    setDoc(
      doc(stranger, 'stores', STORE_ID, 'products', 'product-a'),
      mirroredProduct()
    )
  );
  await assertSucceeds(setDoc(reference, mirroredProduct()));
  await assertFails(
    updateDoc(
      doc(stranger, 'stores', STORE_ID, 'products', 'product-a'),
      { price: 99, updatedAt: serverTimestamp() }
    )
  );
});

test('owner updates and archives a mirror without changing its identity', async () => {
  const owner = environment.authenticatedContext('owner-a').firestore();
  const buyer = environment.authenticatedContext('buyer-a').firestore();
  const reference = doc(owner, 'stores', STORE_ID, 'products', 'product-a');

  await assertSucceeds(setDoc(reference, mirroredProduct()));
  await assertSucceeds(
    updateDoc(reference, {
      price: 22,
      legacyUpdatedAt: '2026-07-22T10:05:00.000Z',
      updatedByUserId: 'owner-a',
      updatedByRole: 'owner',
      updatedAt: serverTimestamp(),
    })
  );
  await assertFails(
    updateDoc(reference, {
      legacyStoreId: 'another-store',
      updatedByUserId: 'owner-a',
      updatedByRole: 'owner',
      updatedAt: serverTimestamp(),
    })
  );
  await assertSucceeds(
    updateDoc(reference, {
      publicationStatus: 'archived',
      archivedAt: serverTimestamp(),
      updatedByUserId: 'owner-a',
      updatedByRole: 'owner',
      updatedAt: serverTimestamp(),
    })
  );
  await assertFails(
    getDoc(doc(buyer, 'stores', STORE_ID, 'products', 'product-a'))
  );
  await assertSucceeds(getDoc(reference));
});

test('manager creates canonical drafts and edits products without rewriting legacy provenance', async () => {
  const manager = environment.authenticatedContext('manager-a').firestore();
  const owner = environment.authenticatedContext('owner-a').firestore();
  const managerReference = doc(
    manager,
    'stores',
    STORE_ID,
    'products',
    'product-manager-a'
  );

  await assertSucceeds(setDoc(managerReference, directManagerProduct()));

  const migratedReference = doc(
    owner,
    'stores',
    STORE_ID,
    'products',
    'product-a'
  );
  await assertSucceeds(setDoc(migratedReference, mirroredProduct()));
  await assertSucceeds(
    updateDoc(
      doc(manager, 'stores', STORE_ID, 'products', 'product-a'),
      {
        name: 'Produto revisado',
        updatedByUserId: 'manager-a',
        updatedByRole: 'manager',
        updatedAt: serverTimestamp(),
      }
    )
  );
  await assertFails(
    updateDoc(
      doc(manager, 'stores', STORE_ID, 'products', 'product-a'),
      {
        legacyUpdatedAt: 'alterado-pelo-gerente',
        updatedByUserId: 'manager-a',
        updatedByRole: 'manager',
        updatedAt: serverTimestamp(),
      }
    )
  );
});
