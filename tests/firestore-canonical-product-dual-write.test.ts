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

test('owner can publish a canonical subscription with contract offers and customization', async () => {
  const owner = environment.authenticatedContext('owner-a').firestore();
  const reference = doc(owner, 'stores', STORE_ID, 'products', 'subscription-a');
  await assertSucceeds(setDoc(reference, {
    ...mirroredProduct(),
    id: 'subscription-a',
    legacyProductId: 'subscription-a',
    migratedFromPath: 'tenants/owner-a#publicProducts/subscription-a',
    isService: true,
    stock: 0,
    saleModality: {
      schemaVersion: 1,
      mode: 'subscription',
      subscription: {
        schemaVersion: 1,
        billingInterval: { unit: 'month', count: 1 },
        benefit: { kind: 'access', unitsPerCycle: null },
        autoRenew: true,
      },
    },
    contractDiscounts: [
      { months: 1, discountPercent: 0 },
      { months: 6, discountPercent: 10 },
    ],
    categoryCollections: [{ path: 'assinaturas', name: 'Assinaturas', image: '' }],
    optionGroups: [],
    quickNotes: [],
    isComplimentary: false,
  }));
});

test('manager can create a direct canonical subscription offer without legacy provenance', async () => {
  const manager = environment.authenticatedContext('manager-a').firestore();
  const reference = doc(manager, 'stores', STORE_ID, 'products', 'product-manager-a');
  await assertSucceeds(setDoc(reference, {
    ...directManagerProduct(),
    isService: true,
    stock: 0,
    publicationStatus: 'published',
    saleModality: {
      schemaVersion: 1,
      mode: 'subscription',
      subscription: {
        schemaVersion: 1,
        billingInterval: { unit: 'month', count: 1 },
        benefit: { kind: 'access', unitsPerCycle: null },
        autoRenew: true,
      },
    },
    contractDiscounts: [{ months: 1, discountPercent: 0 }],
    categoryCollections: [],
    optionGroups: [],
    quickNotes: [],
  }));
});

test('canonical cutover blocks legacy mirror creation and updates but keeps direct editing', async () => {
  const owner = environment.authenticatedContext('owner-a').firestore();
  const manager = environment.authenticatedContext('manager-a').firestore();
  const existingReference = doc(owner, 'stores', STORE_ID, 'products', 'product-a');

  await assertSucceeds(setDoc(existingReference, mirroredProduct()));
  await environment.withSecurityRulesDisabled(async context => {
    await updateDoc(doc(context.firestore(), 'stores', STORE_ID), {
      migrationStatus: 'canonical',
    });
  });

  await assertFails(setDoc(
    doc(owner, 'stores', STORE_ID, 'products', 'product-b'),
    {
      ...mirroredProduct(),
      id: 'product-b',
      legacyProductId: 'product-b',
      migratedFromPath: 'tenants/owner-a#publicProducts/product-b',
    }
  ));
  await assertFails(updateDoc(existingReference, {
    price: 23,
    legacyUpdatedAt: '2026-07-22T10:05:00.000Z',
    updatedByUserId: 'owner-a',
    updatedByRole: 'owner',
    updatedAt: serverTimestamp(),
  }));
  // Cutover must not make previously migrated products read-only.
  await assertSucceeds(updateDoc(existingReference, {
    price: 24,
    updatedByUserId: 'owner-a',
    updatedByRole: 'owner',
    updatedAt: serverTimestamp(),
  }));
  await assertSucceeds(updateDoc(
    doc(manager, 'stores', STORE_ID, 'products', 'product-a'),
    {
      name: 'Produto migrado editado pelo gerente',
      updatedByUserId: 'manager-a',
      updatedByRole: 'manager',
      updatedAt: serverTimestamp(),
    }
  ));
  await assertFails(updateDoc(
    doc(manager, 'stores', STORE_ID, 'products', 'product-a'),
    {
      legacyUpdatedAt: '2026-07-22T11:00:00.000Z',
      updatedByUserId: 'manager-a',
      updatedByRole: 'manager',
      updatedAt: serverTimestamp(),
    }
  ));
  await assertSucceeds(setDoc(
    doc(manager, 'stores', STORE_ID, 'products', 'product-manager-a'),
    directManagerProduct()
  ));
});

test('rejects contract discounts without subscription modality', async () => {
  const owner = environment.authenticatedContext('owner-a').firestore();
  await assertFails(setDoc(doc(owner, 'stores', STORE_ID, 'products', 'product-a'), {
    ...mirroredProduct(),
    saleModality: { schemaVersion: 1, mode: 'one_time', subscription: null },
    contractDiscounts: [{ months: 1, discountPercent: 0 }],
  }));
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
