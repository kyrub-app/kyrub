import { readFileSync } from 'node:fs';
import assert from 'node:assert/strict';
import { after, before, beforeEach, test } from 'node:test';
import {
  assertFails,
  assertSucceeds,
  initializeTestEnvironment,
  type RulesTestEnvironment,
} from '@firebase/rules-unit-testing';
import { doc, getDoc, serverTimestamp, setDoc, updateDoc } from 'firebase/firestore';

const PROJECT_ID = 'kyrub-security-test';
const USER_ID = 'visibility-owner';
const PATH = 'users/' + USER_ID;
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

async function createProfile() {
  const owner = environment.authenticatedContext(USER_ID).firestore();
  await assertSucceeds(setDoc(doc(owner, PATH), {
    uid: USER_ID,
    name: 'Perfil de Teste',
    email: 'owner@example.test',
    photoUrl: '',
    isProfileVisible: true,
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  }));
  return owner;
}

test('profile owner may hide and reveal their directory visibility without changing account data', async () => {
  const owner = await createProfile();
  await assertSucceeds(updateDoc(doc(owner, PATH), {
    isProfileVisible: false,
    updatedAt: serverTimestamp(),
  }));
  const hiddenSnapshot = await assertSucceeds(getDoc(doc(owner, PATH)));
  assert.equal(hiddenSnapshot.data()?.isProfileVisible, false);
  assert.equal(hiddenSnapshot.data()?.name, 'Perfil de Teste');

  await assertSucceeds(updateDoc(doc(owner, PATH), {
    isProfileVisible: true,
    updatedAt: serverTimestamp(),
  }));
  const visibleSnapshot = await assertSucceeds(getDoc(doc(owner, PATH)));
  assert.equal(visibleSnapshot.data()?.isProfileVisible, true);
});

test('another user cannot change profile visibility', async () => {
  await createProfile();
  const other = environment.authenticatedContext('visibility-visitor').firestore();
  await assertFails(updateDoc(doc(other, PATH), {
    isProfileVisible: false,
    updatedAt: serverTimestamp(),
  }));
});

test('anonymous visitor cannot change profile visibility', async () => {
  await createProfile();
  const anonymous = environment.unauthenticatedContext().firestore();
  await assertFails(updateDoc(doc(anonymous, PATH), {
    isProfileVisible: false,
    updatedAt: serverTimestamp(),
  }));
});
