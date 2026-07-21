import { readFileSync } from 'node:fs';
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

const PROJECT_ID = 'kyrub-marketplace-rules-test';
const FIRESTORE_HOST = '127.0.0.1';
const FIRESTORE_PORT = 8080;

let testEnvironment: RulesTestEnvironment;

const authenticatedContext = (uid: string): RulesTestContext =>
  testEnvironment.authenticatedContext(uid);

const unauthenticatedContext = (): RulesTestContext =>
  testEnvironment.unauthenticatedContext();

const storePath = (storeId: string): string =>
  `marketplace_stores/${storeId}`;

const offerPath = (storeId: string, offerId: string): string =>
  `marketplace_stores/${storeId}/offers/${offerId}`;

const validStorePayload = (
  uid: string,
  overrides: Record<string, unknown> = {},
): Record<string, unknown> => ({
  id: uid,
  ownerId: uid,
  name: 'Loja Pública',
  slug: 'loja-publica',
  description: 'Descrição pública da loja',
  logo: '',
  banner: '',
  primaryColor: '#f97316',
  keywords: ['local'],
  address: 'Rua pública, 100',
  status: 'open',
  publicationStatus: 'published',
  createdAt: serverTimestamp(),
  updatedAt: serverTimestamp(),
  publishedAt: serverTimestamp(),
  ...overrides,
});

const validOfferPayload = (
  storeId: string,
  offerId: string,
  overrides: Record<string, unknown> = {},
): Record<string, unknown> => ({
  id: offerId,
  storeId,
  ownerId: storeId,
  name: 'Oferta pública',
  description: 'Descrição pública da oferta',
  price: 25,
  imageUrls: [],
  stock: 10,
  isService: false,
  category: 'Geral',
  status: 'published',
  createdAt: serverTimestamp(),
  updatedAt: serverTimestamp(),
  publishedAt: serverTimestamp(),
  ...overrides,
});

const seedStore = async (
  storeId: string,
  overrides: Record<string, unknown> = {},
): Promise<void> => {
  await testEnvironment.withSecurityRulesDisabled(async context => {
    await setDoc(doc(context.firestore(), storePath(storeId)), {
      id: storeId,
      ownerId: storeId,
      name: 'Loja Pública',
      slug: 'loja-publica',
      description: 'Descrição pública da loja',
      logo: '',
      banner: '',
      primaryColor: '#f97316',
      keywords: ['local'],
      address: 'Rua pública, 100',
      status: 'open',
      publicationStatus: 'published',
      createdAt: Timestamp.now(),
      updatedAt: Timestamp.now(),
      publishedAt: Timestamp.now(),
      ...overrides,
    });
  });
};

const seedOffer = async (
  storeId: string,
  offerId: string,
  overrides: Record<string, unknown> = {},
): Promise<void> => {
  await testEnvironment.withSecurityRulesDisabled(async context => {
    await setDoc(doc(context.firestore(), offerPath(storeId, offerId)), {
      id: offerId,
      storeId,
      ownerId: storeId,
      name: 'Oferta pública',
      description: 'Descrição pública da oferta',
      price: 25,
      imageUrls: [],
      stock: 10,
      isService: false,
      category: 'Geral',
      status: 'published',
      createdAt: Timestamp.now(),
      updatedAt: Timestamp.now(),
      publishedAt: Timestamp.now(),
      ...overrides,
    });
  });
};

before(async () => {
  const rules = readFileSync(
    new URL('../../firestore.rules', import.meta.url),
    'utf8',
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

describe('marketplace store creation', () => {
  test('1. owner creates a valid published store', async () => {
    const database = authenticatedContext('user-a').firestore();
    await assertSucceeds(
      setDoc(doc(database, storePath('user-a')), validStorePayload('user-a')),
    );
  });

  test('2. owner creates a valid draft without publishedAt', async () => {
    const database = authenticatedContext('user-a').firestore();
    const payload = validStorePayload('user-a', {
      publicationStatus: 'draft',
    });
    delete payload.publishedAt;

    await assertSucceeds(setDoc(doc(database, storePath('user-a')), payload));
  });

  test('3. another user cannot create the store', async () => {
    const database = authenticatedContext('user-b').firestore();
    await assertFails(
      setDoc(doc(database, storePath('user-a')), validStorePayload('user-a')),
    );
  });

  test('4. unauthenticated user cannot create a store', async () => {
    const database = unauthenticatedContext().firestore();
    await assertFails(
      setDoc(doc(database, storePath('user-a')), validStorePayload('user-a')),
    );
  });

  test('5. owner cannot create a non-deterministic store path', async () => {
    const database = authenticatedContext('user-a').firestore();
    await assertFails(
      setDoc(doc(database, storePath('other-store')), validStorePayload('user-a')),
    );
  });

  test('6. store id must match the authenticated UID', async () => {
    const database = authenticatedContext('user-a').firestore();
    await assertFails(
      setDoc(
        doc(database, storePath('user-a')),
        validStorePayload('user-a', { id: 'user-b' }),
      ),
    );
  });

  test('7. ownerId must match the authenticated UID', async () => {
    const database = authenticatedContext('user-a').firestore();
    await assertFails(
      setDoc(
        doc(database, storePath('user-a')),
        validStorePayload('user-a', { ownerId: 'user-b' }),
      ),
    );
  });

  test('8. private owner email cannot be published', async () => {
    const database = authenticatedContext('user-a').firestore();
    await assertFails(
      setDoc(
        doc(database, storePath('user-a')),
        validStorePayload('user-a', { ownerEmail: 'owner@example.com' }),
      ),
    );
  });

  test('9. private contact cannot be published', async () => {
    const database = authenticatedContext('user-a').firestore();
    await assertFails(
      setDoc(
        doc(database, storePath('user-a')),
        validStorePayload('user-a', { contact: 'Private contact' }),
      ),
    );
  });

  test('10. address is required for a public store', async () => {
    const database = authenticatedContext('user-a').firestore();
    const payload = validStorePayload('user-a');
    delete payload.address;

    await assertFails(setDoc(doc(database, storePath('user-a')), payload));
  });

  test('11. invalid publication status is denied', async () => {
    const database = authenticatedContext('user-a').firestore();
    await assertFails(
      setDoc(
        doc(database, storePath('user-a')),
        validStorePayload('user-a', { publicationStatus: 'unknown' }),
      ),
    );
  });

  test('12. published store requires publishedAt', async () => {
    const database = authenticatedContext('user-a').firestore();
    const payload = validStorePayload('user-a');
    delete payload.publishedAt;

    await assertFails(setDoc(doc(database, storePath('user-a')), payload));
  });

  test('13. draft store cannot forge publishedAt', async () => {
    const database = authenticatedContext('user-a').firestore();
    await assertFails(
      setDoc(
        doc(database, storePath('user-a')),
        validStorePayload('user-a', { publicationStatus: 'draft' }),
      ),
    );
  });

  test('14. invalid coordinates are denied', async () => {
    const database = authenticatedContext('user-a').firestore();
    await assertFails(
      setDoc(
        doc(database, storePath('user-a')),
        validStorePayload('user-a', { lat: 91, lng: 0 }),
      ),
    );
  });
});

describe('marketplace store reads', () => {
  test('15. owner can get their own draft', async () => {
    await seedStore('user-a', { publicationStatus: 'draft', publishedAt: null });
    const database = authenticatedContext('user-a').firestore();
    await assertSucceeds(getDoc(doc(database, storePath('user-a'))));
  });

  test('16. another user cannot get a draft', async () => {
    await seedStore('user-a', { publicationStatus: 'draft', publishedAt: null });
    const database = authenticatedContext('user-b').firestore();
    await assertFails(getDoc(doc(database, storePath('user-a'))));
  });

  test('17. unauthenticated user cannot get a published store', async () => {
    await seedStore('user-a');
    const database = unauthenticatedContext().firestore();
    await assertFails(getDoc(doc(database, storePath('user-a'))));
  });

  test('18. signed-in user can get a published store', async () => {
    await seedStore('user-a');
    const database = authenticatedContext('user-b').firestore();
    await assertSucceeds(getDoc(doc(database, storePath('user-a'))));
  });

  test('19. signed-in user can query published stores', async () => {
    await seedStore('user-a');
    await seedStore('user-b', { publicationStatus: 'draft', publishedAt: null });
    const database = authenticatedContext('user-c').firestore();
    await assertSucceeds(
      getDocs(
        query(
          collection(database, 'marketplace_stores'),
          where('publicationStatus', '==', 'published'),
        ),
      ),
    );
  });

  test('20. unfiltered marketplace store listing is denied', async () => {
    await seedStore('user-a');
    const database = authenticatedContext('user-b').firestore();
    await assertFails(getDocs(collection(database, 'marketplace_stores')));
  });
});

describe('marketplace store updates', () => {
  test('21. owner updates public fields and timestamp', async () => {
    await seedStore('user-a');
    const database = authenticatedContext('user-a').firestore();
    await assertSucceeds(
      updateDoc(doc(database, storePath('user-a')), {
        name: 'Loja Atualizada',
        description: 'Nova descrição',
        address: 'Novo endereço público',
        updatedAt: serverTimestamp(),
      }),
    );
  });

  test('22. another user cannot update the store', async () => {
    await seedStore('user-a');
    const database = authenticatedContext('user-b').firestore();
    await assertFails(
      updateDoc(doc(database, storePath('user-a')), {
        name: 'Ataque',
        updatedAt: serverTimestamp(),
      }),
    );
  });

  test('23. immutable store identity cannot change', async () => {
    await seedStore('user-a');
    const database = authenticatedContext('user-a').firestore();
    await assertFails(
      updateDoc(doc(database, storePath('user-a')), {
        id: 'user-b',
        updatedAt: serverTimestamp(),
      }),
    );
  });

  test('24. createdAt cannot change', async () => {
    await seedStore('user-a');
    const database = authenticatedContext('user-a').firestore();
    await assertFails(
      updateDoc(doc(database, storePath('user-a')), {
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      }),
    );
  });

  test('25. existing publishedAt cannot be rewritten', async () => {
    await seedStore('user-a');
    const database = authenticatedContext('user-a').firestore();
    await assertFails(
      updateDoc(doc(database, storePath('user-a')), {
        publishedAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      }),
    );
  });

  test('26. owner publishes a draft with server timestamps', async () => {
    await seedStore('user-a', { publicationStatus: 'draft', publishedAt: null });
    const database = authenticatedContext('user-a').firestore();
    await assertSucceeds(
      updateDoc(doc(database, storePath('user-a')), {
        publicationStatus: 'published',
        publishedAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      }),
    );
  });

  test('27. deleting a marketplace store is denied', async () => {
    await seedStore('user-a');
    const database = authenticatedContext('user-a').firestore();
    await assertFails(deleteDoc(doc(database, storePath('user-a'))));
  });
});

describe('marketplace offers', () => {
  test('28. owner creates a valid published offer', async () => {
    await seedStore('user-a');
    const database = authenticatedContext('user-a').firestore();
    await assertSucceeds(
      setDoc(
        doc(database, offerPath('user-a', 'offer-1')),
        validOfferPayload('user-a', 'offer-1'),
      ),
    );
  });

  test('29. another user cannot create an offer', async () => {
    await seedStore('user-a');
    const database = authenticatedContext('user-b').firestore();
    await assertFails(
      setDoc(
        doc(database, offerPath('user-a', 'offer-1')),
        validOfferPayload('user-a', 'offer-1'),
      ),
    );
  });

  test('30. offer ownerId must match the store owner', async () => {
    await seedStore('user-a');
    const database = authenticatedContext('user-a').firestore();
    await assertFails(
      setDoc(
        doc(database, offerPath('user-a', 'offer-1')),
        validOfferPayload('user-a', 'offer-1', { ownerId: 'user-b' }),
      ),
    );
  });

  test('31. private or unknown offer fields are denied', async () => {
    await seedStore('user-a');
    const database = authenticatedContext('user-a').firestore();
    await assertFails(
      setDoc(
        doc(database, offerPath('user-a', 'offer-1')),
        validOfferPayload('user-a', 'offer-1', { supplierEmail: 'private@example.com' }),
      ),
    );
  });

  test('32. negative price is denied', async () => {
    await seedStore('user-a');
    const database = authenticatedContext('user-a').firestore();
    await assertFails(
      setDoc(
        doc(database, offerPath('user-a', 'offer-1')),
        validOfferPayload('user-a', 'offer-1', { price: -1 }),
      ),
    );
  });

  test('33. fractional stock is denied', async () => {
    await seedStore('user-a');
    const database = authenticatedContext('user-a').firestore();
    await assertFails(
      setDoc(
        doc(database, offerPath('user-a', 'offer-1')),
        validOfferPayload('user-a', 'offer-1', { stock: 1.5 }),
      ),
    );
  });

  test('34. signed-in user reads a published offer from a published store', async () => {
    await seedStore('user-a');
    await seedOffer('user-a', 'offer-1');
    const database = authenticatedContext('user-b').firestore();
    await assertSucceeds(getDoc(doc(database, offerPath('user-a', 'offer-1'))));
  });

  test('35. another user cannot read an offer when the store is not published', async () => {
    await seedStore('user-a', { publicationStatus: 'paused' });
    await seedOffer('user-a', 'offer-1');
    const database = authenticatedContext('user-b').firestore();
    await assertFails(getDoc(doc(database, offerPath('user-a', 'offer-1'))));
  });

  test('36. another user cannot read a draft offer', async () => {
    await seedStore('user-a');
    await seedOffer('user-a', 'offer-1', { status: 'draft', publishedAt: null });
    const database = authenticatedContext('user-b').firestore();
    await assertFails(getDoc(doc(database, offerPath('user-a', 'offer-1'))));
  });

  test('37. signed-in user queries published offers', async () => {
    await seedStore('user-a');
    await seedOffer('user-a', 'offer-1');
    await seedOffer('user-a', 'offer-2', { status: 'draft', publishedAt: null });
    const database = authenticatedContext('user-b').firestore();
    await assertSucceeds(
      getDocs(
        query(
          collection(database, `marketplace_stores/user-a/offers`),
          where('status', '==', 'published'),
        ),
      ),
    );
  });

  test('38. unfiltered offer listing is denied', async () => {
    await seedStore('user-a');
    await seedOffer('user-a', 'offer-1');
    const database = authenticatedContext('user-b').firestore();
    await assertFails(
      getDocs(collection(database, 'marketplace_stores/user-a/offers')),
    );
  });

  test('39. owner updates offer fields and timestamp', async () => {
    await seedStore('user-a');
    await seedOffer('user-a', 'offer-1');
    const database = authenticatedContext('user-a').firestore();
    await assertSucceeds(
      updateDoc(doc(database, offerPath('user-a', 'offer-1')), {
        name: 'Oferta Atualizada',
        price: 30,
        stock: 5,
        updatedAt: serverTimestamp(),
      }),
    );
  });

  test('40. another user cannot update an offer', async () => {
    await seedStore('user-a');
    await seedOffer('user-a', 'offer-1');
    const database = authenticatedContext('user-b').firestore();
    await assertFails(
      updateDoc(doc(database, offerPath('user-a', 'offer-1')), {
        price: 0,
        updatedAt: serverTimestamp(),
      }),
    );
  });

  test('41. deleting an offer is denied', async () => {
    await seedStore('user-a');
    await seedOffer('user-a', 'offer-1');
    const database = authenticatedContext('user-a').firestore();
    await assertFails(deleteDoc(doc(database, offerPath('user-a', 'offer-1'))));
  });
});
