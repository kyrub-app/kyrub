import { readFileSync } from 'node:fs';
import { after, before, beforeEach, test } from 'node:test';
import {
  assertFails,
  assertSucceeds,
  initializeTestEnvironment,
  type RulesTestEnvironment,
} from '@firebase/rules-unit-testing';
import {
  deleteDoc,
  doc,
  getDoc,
  serverTimestamp,
  setDoc,
  updateDoc,
} from 'firebase/firestore';

const PROJECT_ID = 'kyrub-security-test';
const OWNER_ID = 'profile-owner';
const PROFILE_PATH = `users/${OWNER_ID}/public_profile/main`;
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

const profilePayload = () => ({
  userId: OWNER_ID,
  name: 'Perfil Kyrub',
  bio: 'Uma breve apresentação pública.',
  photoUrl: 'https://example.com/photo.jpg',
  updatedAt: serverTimestamp(),
});

test('owner creates and updates the public profile extension', async () => {
  const owner = environment.authenticatedContext(OWNER_ID).firestore();
  await assertSucceeds(setDoc(doc(owner, PROFILE_PATH), profilePayload()));
  await assertSucceeds(
    updateDoc(doc(owner, PROFILE_PATH), {
      bio: 'Apresentação atualizada.',
      updatedAt: serverTimestamp(),
    })
  );
});

test('another authenticated user can read but cannot change the profile', async () => {
  const owner = environment.authenticatedContext(OWNER_ID).firestore();
  const visitor = environment.authenticatedContext('profile-visitor').firestore();
  await assertSucceeds(setDoc(doc(owner, PROFILE_PATH), profilePayload()));
  await assertSucceeds(getDoc(doc(visitor, PROFILE_PATH)));
  await assertFails(
    updateDoc(doc(visitor, PROFILE_PATH), {
      bio: 'Alteração indevida.',
      updatedAt: serverTimestamp(),
    })
  );
});

test('invalid profile shapes and unauthenticated reads are rejected', async () => {
  const owner = environment.authenticatedContext(OWNER_ID).firestore();
  const visitor = environment.unauthenticatedContext().firestore();
  await assertFails(
    setDoc(doc(owner, PROFILE_PATH), {
      ...profilePayload(),
      bio: 'x'.repeat(281),
    })
  );
  await assertFails(
    setDoc(doc(owner, `users/${OWNER_ID}/public_profile/secondary`), profilePayload())
  );
  await assertFails(getDoc(doc(visitor, PROFILE_PATH)));
});

test('public profile extensions cannot be deleted by clients', async () => {
  const owner = environment.authenticatedContext(OWNER_ID).firestore();
  await assertSucceeds(setDoc(doc(owner, PROFILE_PATH), profilePayload()));
  await assertFails(deleteDoc(doc(owner, PROFILE_PATH)));
});
