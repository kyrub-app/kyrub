import { readFileSync } from 'node:fs';
import { after, before, beforeEach, test } from 'node:test';
import {
  assertFails,
  assertSucceeds,
  initializeTestEnvironment,
  type RulesTestEnvironment,
} from '@firebase/rules-unit-testing';
import { doc, setDoc } from 'firebase/firestore';
import { deleteObject, getBytes, ref, uploadBytes } from 'firebase/storage';

const PROJECT_ID = 'kyrub-identity-security-test';
const OWNER_ID = 'community_cover_owner';
const MEMBER_ID = 'community_cover_member';
let environment: RulesTestEnvironment;

before(async () => {
  environment = await initializeTestEnvironment({
    projectId: PROJECT_ID,
    firestore: {
      rules: readFileSync('.firebase/firestore.combined.rules', 'utf8'),
      host: '127.0.0.1',
      port: 8090,
    },
    storage: {
      rules: readFileSync('storage.rules', 'utf8'),
      host: '127.0.0.1',
      port: 9198,
    },
  });
});

beforeEach(async () => {
  await environment.clearFirestore();
  await environment.clearStorage();
  await environment.withSecurityRulesDisabled(async context => {
    const firestore = context.firestore();
    await setDoc(doc(firestore, 'communities', 'public_cover'), {
      ownerId: OWNER_ID,
      visibility: 'public',
    });
    await setDoc(doc(firestore, 'communities', 'private_cover'), {
      ownerId: OWNER_ID,
      visibility: 'private',
    });
    await setDoc(
      doc(
        firestore,
        'community_members',
        `private_cover__${MEMBER_ID}`
      ),
      {
        communityId: 'private_cover',
        userId: MEMBER_ID,
        status: 'active',
      }
    );
  });
});

after(async () => {
  await environment.cleanup();
});

const metadata = (communityId: string, ownerId = OWNER_ID) => ({
  contentType: 'image/jpeg',
  customMetadata: {
    communityId,
    ownerId,
  },
});

const appImageMetadata = (contentHash: string, ownerId = OWNER_ID) => ({
  contentType: 'image/webp',
  customMetadata: {
    ownerId,
    contentHash,
    originalName: 'produto.webp',
  },
});

test('community creator uploads, reads and removes the cover', async () => {
  const ownerStorage = environment.authenticatedContext(OWNER_ID).storage();
  const cover = ref(
    ownerStorage,
    `community-covers/public_cover/${OWNER_ID}/cover.jpg`
  );
  await assertSucceeds(
    uploadBytes(cover, new Uint8Array([1, 2, 3]), metadata('public_cover'))
  );
  await assertSucceeds(getBytes(cover));
  await assertSucceeds(deleteObject(cover));
});

test('another profile reads a public cover but cannot replace it', async () => {
  const ownerStorage = environment.authenticatedContext(OWNER_ID).storage();
  const path = `community-covers/public_cover/${OWNER_ID}/cover.jpg`;
  await assertSucceeds(
    uploadBytes(
      ref(ownerStorage, path),
      new Uint8Array([1]),
      metadata('public_cover')
    )
  );

  const visitorStorage = environment.authenticatedContext('visitor').storage();
  await assertSucceeds(getBytes(ref(visitorStorage, path)));
  await assertFails(
    uploadBytes(
      ref(visitorStorage, path),
      new Uint8Array([9]),
      metadata('public_cover')
    )
  );
});

test('private covers are visible only to the owner and active members', async () => {
  const ownerStorage = environment.authenticatedContext(OWNER_ID).storage();
  const path = `community-covers/private_cover/${OWNER_ID}/cover.jpg`;
  await assertSucceeds(
    uploadBytes(
      ref(ownerStorage, path),
      new Uint8Array([1]),
      metadata('private_cover')
    )
  );

  const memberStorage = environment.authenticatedContext(MEMBER_ID).storage();
  const outsiderStorage = environment.authenticatedContext('outsider').storage();
  await assertSucceeds(getBytes(ref(memberStorage, path)));
  await assertFails(getBytes(ref(outsiderStorage, path)));
});

test('forged metadata and oversized non-image content are rejected', async () => {
  const ownerStorage = environment.authenticatedContext(OWNER_ID).storage();
  await assertFails(
    uploadBytes(
      ref(
        ownerStorage,
        `community-covers/public_cover/${OWNER_ID}/forged.jpg`
      ),
      new Uint8Array([1]),
      metadata('another_community')
    )
  );
  await assertFails(
    uploadBytes(
      ref(
        ownerStorage,
        `community-covers/public_cover/${OWNER_ID}/cover.txt`
      ),
      new Uint8Array([1]),
      {
        contentType: 'text/plain',
        customMetadata: {
          communityId: 'public_cover',
          ownerId: OWNER_ID,
        },
      }
    )
  );
});

test('owner uploads a content-addressed app image that public storefronts can read', async () => {
  const hash = 'a'.repeat(64);
  const path = `app-images/${OWNER_ID}/${hash}`;
  const ownerStorage = environment.authenticatedContext(OWNER_ID).storage();

  await assertSucceeds(
    uploadBytes(
      ref(ownerStorage, path),
      new Uint8Array([1, 2, 3]),
      appImageMetadata(hash)
    )
  );
  await assertSucceeds(
    getBytes(ref(environment.unauthenticatedContext().storage(), path))
  );
  await assertSucceeds(deleteObject(ref(ownerStorage, path)));
});

test('another user cannot replace or delete an app image', async () => {
  const hash = 'b'.repeat(64);
  const path = `app-images/${OWNER_ID}/${hash}`;
  const ownerStorage = environment.authenticatedContext(OWNER_ID).storage();
  const outsiderStorage = environment.authenticatedContext('outsider').storage();

  await assertSucceeds(
    uploadBytes(
      ref(ownerStorage, path),
      new Uint8Array([1]),
      appImageMetadata(hash)
    )
  );
  await assertFails(
    uploadBytes(
      ref(outsiderStorage, path),
      new Uint8Array([9]),
      appImageMetadata(hash, 'outsider')
    )
  );
  await assertFails(deleteObject(ref(outsiderStorage, path)));
});

test('app images reject a forged hash, forged owner and unsupported content', async () => {
  const hash = 'c'.repeat(64);
  const ownerStorage = environment.authenticatedContext(OWNER_ID).storage();

  await assertFails(
    uploadBytes(
      ref(ownerStorage, `app-images/${OWNER_ID}/${hash}`),
      new Uint8Array([1]),
      appImageMetadata('d'.repeat(64))
    )
  );
  await assertFails(
    uploadBytes(
      ref(ownerStorage, `app-images/${OWNER_ID}/${hash}`),
      new Uint8Array([1]),
      appImageMetadata(hash, 'forged_owner')
    )
  );
  await assertFails(
    uploadBytes(
      ref(ownerStorage, `app-images/${OWNER_ID}/${hash}`),
      new Uint8Array([1]),
      {
        contentType: 'image/gif',
        customMetadata: {
          ownerId: OWNER_ID,
          contentHash: hash,
        },
      }
    )
  );
});
