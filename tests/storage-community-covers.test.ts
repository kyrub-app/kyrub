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
