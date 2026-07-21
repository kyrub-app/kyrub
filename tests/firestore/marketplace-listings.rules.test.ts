import { readFileSync } from 'node:fs';
import assert from 'node:assert/strict';
import { after, before, beforeEach, describe, test } from 'node:test';
import {
  assertFails,
  assertSucceeds,
  initializeTestEnvironment,
} from '@firebase/rules-unit-testing';
import type {
  RulesTestContext,
  RulesTestEnvironment,
} from '@firebase/rules-unit-testing';
import {
  collection,
  deleteDoc,
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

const PROJECT_ID = 'kyrub-marketplace-listings-rules-test';
const FIRESTORE_HOST = '127.0.0.1';
const FIRESTORE_PORT = 8080;

let testEnvironment: RulesTestEnvironment;

const authenticatedContext = (uid: string): RulesTestContext =>
  testEnvironment.authenticatedContext(uid);

const unauthenticatedContext = (): RulesTestContext =>
  testEnvironment.unauthenticatedContext();

const listingId = (uid: string): string => `s_${uid.length}_${uid}`;
const listingPath = (uid: string): string =>
  `marketplace_listings/${listingId(uid)}`;

const validCreatePayload = (
  uid: string,
  overrides: Record<string, unknown> = {}
): Record<string, unknown> => ({
  listingId: listingId(uid),
  listingType: 'store',
  ownerId: uid,
  storeId: uid,
  name: `Loja ${uid}`,
  slug: `loja-${uid}`,
  description: '',
  address: '',
  logo: '',
  banner: '',
  primaryColor: '',
  keywords: [],
  status: 'closed',
  publicationStatus: 'published',
  createdAt: serverTimestamp(),
  updatedAt: serverTimestamp(),
  publishedAt: serverTimestamp(),
  ...overrides,
});

const seedListing = async (
  uid: string,
  publicationStatus: 'draft' | 'published' | 'paused'
): Promise<void> => {
  await testEnvironment.withSecurityRulesDisabled(async context => {
    const timestamp = Timestamp.fromMillis(1_000);
    const payload: Record<string, unknown> = {
      listingId: listingId(uid),
      listingType: 'store',
      ownerId: uid,
      storeId: uid,
      name: `Loja ${uid}`,
      slug: `loja-${uid}`,
      description: '',
      address: '',
      logo: '',
      banner: '',
      primaryColor: '',
      keywords: [],
      status: 'closed',
      publicationStatus,
      createdAt: timestamp,
      updatedAt: timestamp,
    };

    if (publicationStatus === 'published' || publicationStatus === 'paused') {
      payload.publishedAt = timestamp;
    }

    await setDoc(doc(context.firestore(), listingPath(uid)), payload);
  });
};

before(async () => {
  const rules = readFileSync(
    new URL('../../firestore.rules', import.meta.url),
    'utf8'
  );

  testEnvironment = await initializeTestEnvironment({
    projectId: PROJECT_ID,
    firestore: {
      host: FIRESTORE_HOST,
      port: FIRESTORE_PORT,
      rules,
    },
  });
});

beforeEach(async () => {
  await testEnvironment.clearFirestore();
});

after(async () => {
  await testEnvironment.cleanup();
});

describe('marketplace store publication writes', () => {
  test('owner creates a published deterministic listing', async () => {
    const database = authenticatedContext('user-a').firestore();
    await assertSucceeds(
      setDoc(
        doc(database, listingPath('user-a')),
        validCreatePayload('user-a')
      )
    );
  });

  test('owner creates a draft without publishedAt', async () => {
    const database = authenticatedContext('user-a').firestore();
    const payload = validCreatePayload('user-a', {
      publicationStatus: 'draft',
    });
    delete payload.publishedAt;

    await assertSucceeds(
      setDoc(doc(database, listingPath('user-a')), payload)
    );
  });

  test('another user cannot create the owner listing', async () => {
    const database = authenticatedContext('user-b').firestore();
    await assertFails(
      setDoc(
        doc(database, listingPath('user-a')),
        validCreatePayload('user-a')
      )
    );
  });

  test('listing identity fields must remain deterministic and immutable', async () => {
    const database = authenticatedContext('user-a').firestore();
    await assertFails(
      setDoc(
        doc(database, listingPath('user-a')),
        validCreatePayload('user-a', { storeId: 'user-b' })
      )
    );

    await seedListing('user-a', 'published');
    await assertFails(
      updateDoc(doc(database, listingPath('user-a')), {
        ownerId: 'user-b',
        updatedAt: serverTimestamp(),
      })
    );
  });

  test('owner pauses and republishes an existing listing', async () => {
    await seedListing('user-a', 'published');
    const database = authenticatedContext('user-a').firestore();
    const reference = doc(database, listingPath('user-a'));

    await assertSucceeds(
      updateDoc(reference, {
        publicationStatus: 'paused',
        updatedAt: serverTimestamp(),
      })
    );

    await assertSucceeds(
      updateDoc(reference, {
        publicationStatus: 'published',
        publishedAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      })
    );
  });

  test('deleting a listing is denied', async () => {
    await seedListing('user-a', 'published');
    const database = authenticatedContext('user-a').firestore();
    await assertFails(deleteDoc(doc(database, listingPath('user-a'))));
  });
});

describe('marketplace store publication reads', () => {
  test('signed-in users can query only published listings', async () => {
    await seedListing('user-a', 'published');
    await seedListing('user-b', 'paused');
    const database = authenticatedContext('viewer').firestore();

    const snapshot = await assertSucceeds(
      getDocs(
        query(
          collection(database, 'marketplace_listings'),
          where('publicationStatus', '==', 'published')
        )
      )
    );

    assert.equal(snapshot.size, 1);
    assert.equal(snapshot.docs[0]?.data().storeId, 'user-a');
  });

  test('unfiltered marketplace listing queries are denied', async () => {
    await seedListing('user-a', 'published');
    const database = authenticatedContext('viewer').firestore();
    await assertFails(getDocs(collection(database, 'marketplace_listings')));
  });

  test('owner can get a paused listing but another user cannot', async () => {
    await seedListing('user-a', 'paused');

    const ownerSnapshot = await assertSucceeds(
      getDoc(
        doc(
          authenticatedContext('user-a').firestore(),
          listingPath('user-a')
        )
      )
    );
    assert.equal(ownerSnapshot.exists(), true);

    await assertFails(
      getDoc(
        doc(
          authenticatedContext('user-b').firestore(),
          listingPath('user-a')
        )
      )
    );
  });

  test('unauthenticated users cannot read published listings', async () => {
    await seedListing('user-a', 'published');
    const database = unauthenticatedContext().firestore();

    await assertFails(getDoc(doc(database, listingPath('user-a'))));
    await assertFails(
      getDocs(
        query(
          collection(database, 'marketplace_listings'),
          where('publicationStatus', '==', 'published')
        )
      )
    );
  });
});
