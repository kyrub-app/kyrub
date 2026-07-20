import { readFileSync } from 'node:fs';
import assert from 'node:assert/strict';
import { after, before, beforeEach, describe, test } from 'node:test';
import {
  assertFails,
  assertSucceeds,
  initializeTestEnvironment
} from '@firebase/rules-unit-testing';
import type {
  RulesTestContext,
  RulesTestEnvironment
} from '@firebase/rules-unit-testing';
import {
  collection,
  deleteDoc,
  deleteField,
  doc,
  getDoc,
  getDocs,
  serverTimestamp,
  setDoc,
  Timestamp,
  updateDoc
} from 'firebase/firestore';

const PROJECT_ID = 'kyrub-user-stores-rules-test';
const FIRESTORE_HOST = '127.0.0.1';
const FIRESTORE_PORT = 8080;

let testEnvironment: RulesTestEnvironment;

const authenticatedContext = (uid: string): RulesTestContext =>
  testEnvironment.authenticatedContext(uid);

const unauthenticatedContext = (): RulesTestContext =>
  testEnvironment.unauthenticatedContext();

const primaryStorePath = (uid: string): string =>
  `users/${uid}/stores/${uid}`;

const validCreatePayload = (
  uid: string,
  overrides: Record<string, unknown> = {}
): Record<string, unknown> => ({
  id: uid,
  ownerId: uid,
  ownerEmail: 'owner@example.com',
  name: 'Primary Store',
  slug: 'primary-store',
  description: 'Private store profile',
  logo: '',
  banner: '',
  primaryColor: '#000000',
  plan: 'free',
  keywords: ['local'],
  offerImages: [],
  address: 'Private address',
  contact: 'Private contact',
  status: 'open',
  createdAt: serverTimestamp(),
  updatedAt: serverTimestamp(),
  ...overrides
});

const createValidStore = async (
  uid: string,
  overrides: Record<string, unknown> = {}
): Promise<void> => {
  const database = authenticatedContext(uid).firestore();
  await assertSucceeds(
    setDoc(doc(database, primaryStorePath(uid)), validCreatePayload(uid, overrides))
  );
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
      rules
    }
  });
});

beforeEach(async () => {
  await testEnvironment.clearFirestore();
});

after(async () => {
  await testEnvironment.cleanup();
});

describe('private user store access', () => {
  test('1. owner can get an existing primary store', async () => {
    await createValidStore('user-a');
    const database = authenticatedContext('user-a').firestore();
    const snapshot = await assertSucceeds(
      getDoc(doc(database, primaryStorePath('user-a')))
    );

    assert.equal(snapshot.exists(), true);
  });

  test('2. another user cannot get the store', async () => {
    await createValidStore('user-a');
    const database = authenticatedContext('user-b').firestore();
    await assertFails(getDoc(doc(database, primaryStorePath('user-a'))));
  });

  test('3. unauthenticated user cannot get the store', async () => {
    await createValidStore('user-a');
    const database = unauthenticatedContext().firestore();
    await assertFails(getDoc(doc(database, primaryStorePath('user-a'))));
  });

  test('4. owner cannot access another user primary path', async () => {
    await createValidStore('user-b');
    const database = authenticatedContext('user-a').firestore();
    await assertFails(getDoc(doc(database, primaryStorePath('user-b'))));
  });

  test('5. owner cannot access a storeId different from the UID', async () => {
    const database = authenticatedContext('user-a').firestore();
    await assertFails(getDoc(doc(database, 'users/user-a/stores/other-store')));
  });

  test('6. listing the owner store collection is denied', async () => {
    await createValidStore('user-a');
    const database = authenticatedContext('user-a').firestore();
    await assertFails(getDocs(collection(database, 'users/user-a/stores')));
  });

  test('7. deleting the store as owner is denied', async () => {
    await createValidStore('user-a');
    const database = authenticatedContext('user-a').firestore();
    await assertFails(deleteDoc(doc(database, primaryStorePath('user-a'))));
  });
});

describe('accepted user store creation', () => {
  test('8. owner creates a valid deterministic primary store', async () => {
    const database = authenticatedContext('user-a').firestore();
    await assertSucceeds(
      setDoc(doc(database, primaryStorePath('user-a')), validCreatePayload('user-a'))
    );
  });

  test('9. valid latitude and longitude are accepted together', async () => {
    const database = authenticatedContext('user-a').firestore();
    await assertSucceeds(
      setDoc(
        doc(database, primaryStorePath('user-a')),
        validCreatePayload('user-a', { lat: -23.5, lng: -46.6 })
      )
    );
  });

  test('10. ownerEmail is metadata and may differ from the auth email', async () => {
    const database = testEnvironment
      .authenticatedContext('user-a', { email: 'auth@example.com' })
      .firestore();
    await assertSucceeds(
      setDoc(
        doc(database, primaryStorePath('user-a')),
        validCreatePayload('user-a', { ownerEmail: 'metadata@example.com' })
      )
    );
  });
});

describe('denied user store creation identity and plan', () => {
  test('11. create denies an id different from the UID', async () => {
    const database = authenticatedContext('user-a').firestore();
    await assertFails(setDoc(doc(database, primaryStorePath('user-a')), validCreatePayload('user-a', { id: 'user-b' })));
  });

  test('12. create denies an ownerId different from the UID', async () => {
    const database = authenticatedContext('user-a').firestore();
    await assertFails(setDoc(doc(database, primaryStorePath('user-a')), validCreatePayload('user-a', { ownerId: 'user-b' })));
  });

  test('13. create denies a user path different from authenticated UID', async () => {
    const database = authenticatedContext('user-a').firestore();
    await assertFails(setDoc(doc(database, primaryStorePath('user-b')), validCreatePayload('user-b')));
  });

  test('14. create denies storeId different from userId', async () => {
    const database = authenticatedContext('user-a').firestore();
    await assertFails(setDoc(doc(database, 'users/user-a/stores/other-store'), validCreatePayload('user-a')));
  });

  test('15. create denies the business plan', async () => {
    const database = authenticatedContext('user-a').firestore();
    await assertFails(setDoc(doc(database, primaryStorePath('user-a')), validCreatePayload('user-a', { plan: 'business' })));
  });
});

describe('denied user store creation schema', () => {
  test('16. create denies a missing required field', async () => {
    const { name, ...payload } = validCreatePayload('user-a');
    assert.equal(typeof name, 'string');
    const database = authenticatedContext('user-a').firestore();
    await assertFails(setDoc(doc(database, primaryStorePath('user-a')), payload));
  });

  test('17. create denies the extra isNew field', async () => {
    const database = authenticatedContext('user-a').firestore();
    await assertFails(setDoc(doc(database, primaryStorePath('user-a')), validCreatePayload('user-a', { isNew: true })));
  });

  test('18. create denies an unknown field', async () => {
    const database = authenticatedContext('user-a').firestore();
    await assertFails(setDoc(doc(database, primaryStorePath('user-a')), validCreatePayload('user-a', { unknownField: true })));
  });

  test('19. create denies keywords that are not a list', async () => {
    const database = authenticatedContext('user-a').firestore();
    await assertFails(setDoc(doc(database, primaryStorePath('user-a')), validCreatePayload('user-a', { keywords: 'local' })));
  });

  test('20. create denies offerImages that are not a list', async () => {
    const database = authenticatedContext('user-a').firestore();
    await assertFails(setDoc(doc(database, primaryStorePath('user-a')), validCreatePayload('user-a', { offerImages: 'image' })));
  });

  test('21. create denies an invalid status', async () => {
    const database = authenticatedContext('user-a').firestore();
    await assertFails(setDoc(doc(database, primaryStorePath('user-a')), validCreatePayload('user-a', { status: 'paused' })));
  });

  test('22. create denies an invalid plan', async () => {
    const database = authenticatedContext('user-a').firestore();
    await assertFails(setDoc(doc(database, primaryStorePath('user-a')), validCreatePayload('user-a', { plan: 'enterprise' })));
  });

  test('23. create denies createdAt not equal to request.time', async () => {
    const database = authenticatedContext('user-a').firestore();
    await assertFails(setDoc(doc(database, primaryStorePath('user-a')), validCreatePayload('user-a', { createdAt: Timestamp.fromMillis(0) })));
  });

  test('24. create denies updatedAt not equal to request.time', async () => {
    const database = authenticatedContext('user-a').firestore();
    await assertFails(setDoc(doc(database, primaryStorePath('user-a')), validCreatePayload('user-a', { updatedAt: Timestamp.fromMillis(0) })));
  });
});

describe('user store coordinates', () => {
  const deniedCoordinates: ReadonlyArray<readonly [number, string, Record<string, unknown>]> = [
    [25, 'only latitude', { lat: 0 }],
    [26, 'only longitude', { lng: 0 }],
    [27, 'latitude below -90', { lat: -91, lng: 0 }],
    [28, 'latitude above 90', { lat: 91, lng: 0 }],
    [29, 'longitude below -180', { lat: 0, lng: -181 }],
    [30, 'longitude above 180', { lat: 0, lng: 181 }],
    [31, 'non-numeric latitude', { lat: '0', lng: 0 }],
    [32, 'non-numeric longitude', { lat: 0, lng: '0' }]
  ];

  for (const [number, label, coordinates] of deniedCoordinates) {
    test(`${number}. create denies ${label}`, async () => {
      const database = authenticatedContext('user-a').firestore();
      await assertFails(
        setDoc(
          doc(database, primaryStorePath('user-a')),
          validCreatePayload('user-a', coordinates)
        )
      );
    });
  }
});

describe('accepted user store updates', () => {
  test('33. owner updates name and updatedAt', async () => {
    await createValidStore('user-a');
    const database = authenticatedContext('user-a').firestore();
    await assertSucceeds(updateDoc(doc(database, primaryStorePath('user-a')), { name: 'Updated Store', updatedAt: serverTimestamp() }));
  });

  test('34. owner updates allowed profile fields', async () => {
    await createValidStore('user-a');
    const database = authenticatedContext('user-a').firestore();
    await assertSucceeds(updateDoc(doc(database, primaryStorePath('user-a')), {
      slug: 'updated-store',
      description: 'Updated description',
      logo: 'logo',
      banner: 'banner',
      primaryColor: '#ffffff',
      keywords: ['updated'],
      offerImages: ['image'],
      address: 'Updated address',
      contact: 'Updated contact',
      status: 'delayed',
      updatedAt: serverTimestamp()
    }));
  });

  test('35. owner updates latitude and longitude together', async () => {
    await createValidStore('user-a');
    const database = authenticatedContext('user-a').firestore();
    await assertSucceeds(updateDoc(doc(database, primaryStorePath('user-a')), { lat: -23.5, lng: -46.6, updatedAt: serverTimestamp() }));
  });

  test('36. owner removes latitude and longitude together', async () => {
    await createValidStore('user-a', { lat: -23.5, lng: -46.6 });
    const database = authenticatedContext('user-a').firestore();
    await assertSucceeds(updateDoc(doc(database, primaryStorePath('user-a')), { lat: deleteField(), lng: deleteField(), updatedAt: serverTimestamp() }));
  });

  test('37. owner updates ownerEmail as metadata', async () => {
    await createValidStore('user-a');
    const database = authenticatedContext('user-a').firestore();
    await assertSucceeds(updateDoc(doc(database, primaryStorePath('user-a')), { ownerEmail: 'new@example.com', updatedAt: serverTimestamp() }));
  });
});

describe('denied user store updates', () => {
  test('38. another user cannot update the store', async () => {
    await createValidStore('user-a');
    const database = authenticatedContext('user-b').firestore();
    await assertFails(updateDoc(doc(database, primaryStorePath('user-a')), { name: 'Denied', updatedAt: serverTimestamp() }));
  });

  test('39. unauthenticated user cannot update the store', async () => {
    await createValidStore('user-a');
    const database = unauthenticatedContext().firestore();
    await assertFails(updateDoc(doc(database, primaryStorePath('user-a')), { name: 'Denied', updatedAt: serverTimestamp() }));
  });

  test('40. update denies changing id', async () => {
    await createValidStore('user-a');
    const database = authenticatedContext('user-a').firestore();
    await assertFails(updateDoc(doc(database, primaryStorePath('user-a')), { id: 'user-b', updatedAt: serverTimestamp() }));
  });

  test('41. update denies changing ownerId', async () => {
    await createValidStore('user-a');
    const database = authenticatedContext('user-a').firestore();
    await assertFails(updateDoc(doc(database, primaryStorePath('user-a')), { ownerId: 'user-b', updatedAt: serverTimestamp() }));
  });

  test('42. update denies changing createdAt', async () => {
    await createValidStore('user-a');
    const database = authenticatedContext('user-a').firestore();
    await assertFails(updateDoc(doc(database, primaryStorePath('user-a')), { createdAt: serverTimestamp(), updatedAt: serverTimestamp() }));
  });

  test('43. update denies changing plan', async () => {
    await createValidStore('user-a');
    const database = authenticatedContext('user-a').firestore();
    await assertFails(updateDoc(doc(database, primaryStorePath('user-a')), { plan: 'business', updatedAt: serverTimestamp() }));
  });

  test('44. update denies an extra field', async () => {
    await createValidStore('user-a');
    const database = authenticatedContext('user-a').firestore();
    await assertFails(updateDoc(doc(database, primaryStorePath('user-a')), { unknownField: true, updatedAt: serverTimestamp() }));
  });

  test('45. update denies updatedAt not equal to request.time', async () => {
    await createValidStore('user-a');
    const database = authenticatedContext('user-a').firestore();
    await assertFails(updateDoc(doc(database, primaryStorePath('user-a')), { name: 'Denied', updatedAt: Timestamp.fromMillis(0) }));
  });

  test('46. update denies leaving only latitude', async () => {
    await createValidStore('user-a', { lat: 0, lng: 0 });
    const database = authenticatedContext('user-a').firestore();
    await assertFails(updateDoc(doc(database, primaryStorePath('user-a')), { lng: deleteField(), updatedAt: serverTimestamp() }));
  });

  test('47. update denies leaving only longitude', async () => {
    await createValidStore('user-a', { lat: 0, lng: 0 });
    const database = authenticatedContext('user-a').firestore();
    await assertFails(updateDoc(doc(database, primaryStorePath('user-a')), { lat: deleteField(), updatedAt: serverTimestamp() }));
  });

  test('48. update denies an invalid status', async () => {
    await createValidStore('user-a');
    const database = authenticatedContext('user-a').firestore();
    await assertFails(updateDoc(doc(database, primaryStorePath('user-a')), { status: 'paused', updatedAt: serverTimestamp() }));
  });

  test('49. update denies an invalid required field type', async () => {
    await createValidStore('user-a');
    const database = authenticatedContext('user-a').firestore();
    await assertFails(updateDoc(doc(database, primaryStorePath('user-a')), { name: 42, updatedAt: serverTimestamp() }));
  });
});

describe('user store isolation', () => {
  test('50. user-b cannot get, list, update, or delete user-a store data', async () => {
    await createValidStore('user-a');
    const database = authenticatedContext('user-b').firestore();
    const storeReference = doc(database, primaryStorePath('user-a'));

    await assertFails(getDoc(storeReference));
    await assertFails(getDocs(collection(database, 'users/user-a/stores')));
    await assertFails(updateDoc(storeReference, { name: 'Denied', updatedAt: serverTimestamp() }));
    await assertFails(deleteDoc(storeReference));
  });
});
