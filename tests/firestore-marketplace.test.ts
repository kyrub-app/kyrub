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
  doc,
  getDoc,
  getDocs,
  query,
  serverTimestamp,
  setDoc,
  Timestamp,
  updateDoc,
  where,
} from 'firebase/firestore';

const PROJECT_ID = 'kyrub-security-test';
const OWNER_ID = 'owner-marketplace';
const STORE_LISTING_ID = 'store-listing-owner';
const PAUSED_LISTING_ID = 'store-listing-paused';
let environment: RulesTestEnvironment;

const storeListing = (
  listingId: string,
  publicationStatus: 'published' | 'paused' = 'published'
) => ({
  listingId,
  listingType: 'store' as const,
  ownerId: OWNER_ID,
  storeId: OWNER_ID,
  publicationStatus,
  name: 'Loja Marketplace',
  slug: 'loja-marketplace',
  description: 'Descrição pública',
  address: 'Rua A, 10',
  logo: '',
  banner: '',
  primaryColor: '',
  keywords: ['comida'],
  status: 'open',
  createdAt: Timestamp.fromMillis(1_700_000_000_000),
  updatedAt: Timestamp.fromMillis(1_700_000_000_000),
  ...(publicationStatus === 'published'
    ? { publishedAt: Timestamp.fromMillis(1_700_000_000_000) }
    : {}),
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

test('owner creates and updates their marketplace store listing', async () => {
  const owner = environment.authenticatedContext(OWNER_ID).firestore();
  const reference = doc(owner, 'marketplace_listings', STORE_LISTING_ID);

  await assertSucceeds(
    setDoc(reference, {
      ...storeListing(STORE_LISTING_ID),
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
      publishedAt: serverTimestamp(),
    })
  );

  await assertSucceeds(
    updateDoc(reference, {
      description: 'Descrição atualizada',
      updatedAt: serverTimestamp(),
      publishedAt: serverTimestamp(),
    })
  );
});

test('another authenticated user reads only published marketplace listings', async () => {
  await environment.withSecurityRulesDisabled(async context => {
    const database = context.firestore();
    await setDoc(
      doc(database, 'marketplace_listings', STORE_LISTING_ID),
      storeListing(STORE_LISTING_ID)
    );
    await setDoc(
      doc(database, 'marketplace_listings', PAUSED_LISTING_ID),
      storeListing(PAUSED_LISTING_ID, 'paused')
    );
  });

  const customer = environment.authenticatedContext('customer-marketplace').firestore();
  const published = await assertSucceeds(
    getDocs(
      query(
        collection(customer, 'marketplace_listings'),
        where('publicationStatus', '==', 'published')
      )
    )
  );

  if (published.size !== 1) {
    throw new Error(`Expected one published listing, received ${published.size}.`);
  }

  await assertFails(
    getDoc(doc(customer, 'marketplace_listings', PAUSED_LISTING_ID))
  );
});

test('owner may read a paused listing while unauthenticated access stays blocked', async () => {
  await environment.withSecurityRulesDisabled(async context => {
    await setDoc(
      doc(context.firestore(), 'marketplace_listings', PAUSED_LISTING_ID),
      storeListing(PAUSED_LISTING_ID, 'paused')
    );
  });

  const owner = environment.authenticatedContext(OWNER_ID).firestore();
  const anonymous = environment.unauthenticatedContext().firestore();

  await assertSucceeds(
    getDoc(doc(owner, 'marketplace_listings', PAUSED_LISTING_ID))
  );
  await assertFails(
    getDoc(doc(anonymous, 'marketplace_listings', STORE_LISTING_ID))
  );
});

test('another user cannot create or mutate the owner marketplace listing', async () => {
  const attacker = environment.authenticatedContext('attacker-marketplace').firestore();

  await assertFails(
    setDoc(doc(attacker, 'marketplace_listings', STORE_LISTING_ID), {
      ...storeListing(STORE_LISTING_ID),
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
      publishedAt: serverTimestamp(),
    })
  );

  await environment.withSecurityRulesDisabled(async context => {
    await setDoc(
      doc(context.firestore(), 'marketplace_listings', STORE_LISTING_ID),
      storeListing(STORE_LISTING_ID)
    );
  });

  await assertFails(
    updateDoc(doc(attacker, 'marketplace_listings', STORE_LISTING_ID), {
      name: 'Loja invadida',
      updatedAt: serverTimestamp(),
    })
  );
});
