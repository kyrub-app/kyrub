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

const composeRules = (): string => {
  const baseRules = readFileSync(
    new URL('../../firestore.rules', import.meta.url),
    'utf8',
  );
  const marketplaceRules = readFileSync(
    new URL('./marketplace.rules.fragment', import.meta.url),
    'utf8',
  );
  const closingPattern = /\n  }\n}\s*$/;

  if (!closingPattern.test(baseRules)) {
    throw new Error('Unable to compose marketplace rules with firestore.rules.');
  }

  return baseRules.replace(
    closingPattern,
    `\n${marketplaceRules.trimEnd()}\n  }\n}\n`,
  );
};

before(async () => {
  testEnvironment = await initializeTestEnvironment({
    projectId: PROJECT_ID,
    firestore: {
      host: FIRESTORE_HOST,
      port: FIRESTORE_PORT,
      rules: composeRules(),
    },
  });
});

beforeEach(async () => {
  await testEnvironment.clearFirestore();
});

after(async () => {
  await testEnvironment.cleanup();
});

describe('marketplace store writes', () => {
  test('1. owner creates a valid published store', async () => {
    const database = authenticatedContext('user-a').firestore();
    await assertSucceeds(
      setDoc(doc(database, storePath('user-a')), validStorePayload('user-a')),
    );
  });

  test('2. owner creates a draft without publishedAt', async () => {
    const database = authenticatedContext('user-a').firestore();
    const payload = validStorePayload('user-a', { publicationStatus: 'draft' });
    delete payload.publishedAt;
    await assertSucceeds(setDoc(doc(database, storePath('user-a')), payload));
  });

  test('3. another user cannot create the store', async () => {
    const database = authenticatedContext('user-b').firestore();
    await assertFails(
      setDoc(doc(database, storePath('user-a')), validStorePayload('user-a')),
    );
  });

  test('4. path, id and ownerId must match the authenticated UID', async () => {
    const database = authenticatedContext('user-a').firestore();
    await assertFails(
      setDoc(doc(database, storePath('other')), validStorePayload('user-a')),
    );
    await assertFails(
      setDoc(
        doc(database, storePath('user-a')),
        validStorePayload('user-a', { id: 'user-b' }),
      ),
    );
    await assertFails(
      setDoc(
        doc(database, storePath('user-a')),
        validStorePayload('user-a', { ownerId: 'user-b' }),
      ),
    );
  });

  test('5. private and unknown fields cannot be published', async () => {
    const database = authenticatedContext('user-a').firestore();
    await assertFails(
      setDoc(
        doc(database, storePath('user-a')),
        validStorePayload('user-a', { ownerEmail: 'private@example.com' }),
      ),
    );
    await assertFails(
      setDoc(
        doc(database, storePath('user-a')),
        validStorePayload('user-a', { contact: 'Private contact' }),
      ),
    );
  });

  test('6. address is required and invalid coordinates are denied', async () => {
    const database = authenticatedContext('user-a').firestore();
    const missingAddress = validStorePayload('user-a');
    delete missingAddress.address;
    await assertFails(setDoc(doc(database, storePath('user-a')), missingAddress));
    await assertFails(
      setDoc(
        doc(database, storePath('user-a')),
        validStorePayload('user-a', { lat: 91, lng: 0 }),
      ),
    );
  });

  test('7. published store requires request-time publishedAt', async () => {
    const database = authenticatedContext('user-a').firestore();
    const missingPublishedAt = validStorePayload('user-a');
    delete missingPublishedAt.publishedAt;
    await assertFails(
      setDoc(doc(database, storePath('user-a')), missingPublishedAt),
    );
    await assertFails(
      setDoc(
        doc(database, storePath('user-a')),
        validStorePayload('user-a', { publishedAt: Timestamp.fromMillis(0) }),
      ),
    );
  });

  test('8. owner updates public fields', async () => {
    await seedStore('user-a');
    const database = authenticatedContext('user-a').firestore();
    await assertSucceeds(
      updateDoc(doc(database, storePath('user-a')), {
        name: 'Loja Atualizada',
        address: 'Novo endereço público',
        updatedAt: serverTimestamp(),
      }),
    );
  });

  test('9. another user cannot update the store', async () => {
    await seedStore('user-a');
    const database = authenticatedContext('user-b').firestore();
    await assertFails(
      updateDoc(doc(database, storePath('user-a')), {
        name: 'Ataque',
        updatedAt: serverTimestamp(),
      }),
    );
  });

  test('10. owner publishes a draft and cannot rewrite immutable identity', async () => {
    await seedStore('user-a', { publicationStatus: 'draft' });
    const database = authenticatedContext('user-a').firestore();
    await assertSucceeds(
      updateDoc(doc(database, storePath('user-a')), {
        publicationStatus: 'published',
        publishedAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      }),
    );
    await assertFails(
      updateDoc(doc(database, storePath('user-a')), {
        id: 'user-b',
        updatedAt: serverTimestamp(),
      }),
    );
  });

  test('11. deleting a marketplace store is denied', async () => {
    await seedStore('user-a');
    const database = authenticatedContext('user-a').firestore();
    await assertFails(deleteDoc(doc(database, storePath('user-a'))));
  });
});

describe('marketplace store reads', () => {
  test('12. owner can get their draft but another user cannot', async () => {
    await seedStore('user-a', { publicationStatus: 'draft' });
    await assertSucceeds(
      getDoc(doc(authenticatedContext('user-a').firestore(), storePath('user-a'))),
    );
    await assertFails(
      getDoc(doc(authenticatedContext('user-b').firestore(), storePath('user-a'))),
    );
  });

  test('13. signed-in user reads published stores; unauthenticated user cannot', async () => {
    await seedStore('user-a');
    await assertSucceeds(
      getDoc(doc(authenticatedContext('user-b').firestore(), storePath('user-a'))),
    );
    await assertFails(
      getDoc(doc(unauthenticatedContext().firestore(), storePath('user-a'))),
    );
  });

  test('14. published query succeeds and unfiltered list fails', async () => {
    await seedStore('user-a');
    await seedStore('user-b', { publicationStatus: 'draft' });
    const database = authenticatedContext('user-c').firestore();
    await assertSucceeds(
      getDocs(
        query(
          collection(database, 'marketplace_stores'),
          where('publicationStatus', '==', 'published'),
        ),
      ),
    );
    await assertFails(getDocs(collection(database, 'marketplace_stores')));
  });
});

describe('marketplace offers', () => {
  test('15. owner creates a valid published offer', async () => {
    await seedStore('user-a');
    const database = authenticatedContext('user-a').firestore();
    await assertSucceeds(
      setDoc(
        doc(database, offerPath('user-a', 'offer-1')),
        validOfferPayload('user-a', 'offer-1'),
      ),
    );
  });

  test('16. another user cannot create or update an offer', async () => {
    await seedStore('user-a');
    const attacker = authenticatedContext('user-b').firestore();
    await assertFails(
      setDoc(
        doc(attacker, offerPath('user-a', 'offer-1')),
        validOfferPayload('user-a', 'offer-1'),
      ),
    );
    await seedOffer('user-a', 'offer-1');
    await assertFails(
      updateDoc(doc(attacker, offerPath('user-a', 'offer-1')), {
        price: 0,
        updatedAt: serverTimestamp(),
      }),
    );
  });

  test('17. offer identity and private fields are protected', async () => {
    await seedStore('user-a');
    const database = authenticatedContext('user-a').firestore();
    await assertFails(
      setDoc(
        doc(database, offerPath('user-a', 'offer-1')),
        validOfferPayload('user-a', 'offer-1', { ownerId: 'user-b' }),
      ),
    );
    await assertFails(
      setDoc(
        doc(database, offerPath('user-a', 'offer-1')),
        validOfferPayload('user-a', 'offer-1', {
          supplierEmail: 'private@example.com',
        }),
      ),
    );
  });

  test('18. invalid price and stock are denied', async () => {
    await seedStore('user-a');
    const database = authenticatedContext('user-a').firestore();
    await assertFails(
      setDoc(
        doc(database, offerPath('user-a', 'offer-1')),
        validOfferPayload('user-a', 'offer-1', { price: -1 }),
      ),
    );
    await assertFails(
      setDoc(
        doc(database, offerPath('user-a', 'offer-1')),
        validOfferPayload('user-a', 'offer-1', { stock: 1.5 }),
      ),
    );
  });

  test('19. signed-in user reads a published offer from a published store', async () => {
    await seedStore('user-a');
    await seedOffer('user-a', 'offer-1');
    await assertSucceeds(
      getDoc(
        doc(
          authenticatedContext('user-b').firestore(),
          offerPath('user-a', 'offer-1'),
        ),
      ),
    );
  });

  test('20. draft offers and offers from paused stores are private', async () => {
    await seedStore('user-a');
    await seedOffer('user-a', 'offer-1', { status: 'draft' });
    await assertFails(
      getDoc(
        doc(
          authenticatedContext('user-b').firestore(),
          offerPath('user-a', 'offer-1'),
        ),
      ),
    );

    await testEnvironment.clearFirestore();
    await seedStore('user-a', { publicationStatus: 'paused' });
    await seedOffer('user-a', 'offer-1');
    await assertFails(
      getDoc(
        doc(
          authenticatedContext('user-b').firestore(),
          offerPath('user-a', 'offer-1'),
        ),
      ),
    );
  });

  test('21. published offer query succeeds and unfiltered list fails', async () => {
    await seedStore('user-a');
    await seedOffer('user-a', 'offer-1');
    await seedOffer('user-a', 'offer-2', { status: 'draft' });
    const database = authenticatedContext('user-b').firestore();
    await assertSucceeds(
      getDocs(
        query(
          collection(database, 'marketplace_stores/user-a/offers'),
          where('status', '==', 'published'),
        ),
      ),
    );
    await assertFails(
      getDocs(collection(database, 'marketplace_stores/user-a/offers')),
    );
  });

  test('22. owner updates an offer but cannot change immutable identity', async () => {
    await seedStore('user-a');
    await seedOffer('user-a', 'offer-1');
    const database = authenticatedContext('user-a').firestore();
    await assertSucceeds(
      updateDoc(doc(database, offerPath('user-a', 'offer-1')), {
        name: 'Oferta Atualizada',
        price: 30,
        updatedAt: serverTimestamp(),
      }),
    );
    await assertFails(
      updateDoc(doc(database, offerPath('user-a', 'offer-1')), {
        storeId: 'user-b',
        updatedAt: serverTimestamp(),
      }),
    );
  });

  test('23. unauthenticated user cannot read a published offer', async () => {
    await seedStore('user-a');
    await seedOffer('user-a', 'offer-1');
    await assertFails(
      getDoc(
        doc(
          unauthenticatedContext().firestore(),
          offerPath('user-a', 'offer-1'),
        ),
      ),
    );
  });

  test('24. deleting an offer is denied', async () => {
    await seedStore('user-a');
    await seedOffer('user-a', 'offer-1');
    const database = authenticatedContext('user-a').firestore();
    await assertFails(deleteDoc(doc(database, offerPath('user-a', 'offer-1'))));
  });
});
