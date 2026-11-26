import { readFileSync } from 'node:fs';
import assert from 'node:assert/strict';
import { after, before, beforeEach, test } from 'node:test';
import {
  assertFails,
  assertSucceeds,
  initializeTestEnvironment,
  type RulesTestEnvironment,
} from '@firebase/rules-unit-testing';
import { collection, doc, getDoc, getDocs, query, where, serverTimestamp, setDoc, updateDoc } from 'firebase/firestore';

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


// Exercise the proposed owner-only rule against the complete composed rules.
// Never change the deployment artifact or activate a production flag here.
test('isolated root privacy candidate denies direct cross-account reads and preserves scoped access', async () => {
  const baseline = readFileSync('.firebase/firestore.combined.rules', 'utf8');
  const rootRead = /match \/users\/\{userId\}\s*\{\s*allow read: if isSignedIn\(\);/g;
  assert.equal([...baseline.matchAll(rootRead)].length, 1, 'review the actual root rule before testing the candidate');
  const candidate = baseline.replace(rootRead, `match /users/{userId} {
      allow get: if isSignedIn() && request.auth.uid == userId;
      allow list: if false;`);
  const isolated = await initializeTestEnvironment({
    projectId: PROJECT_ID,
    firestore: { rules: candidate, host: '127.0.0.1', port: 8088 },
  });
  try {
    await isolated.clearFirestore();
    const owner = isolated.authenticatedContext(USER_ID).firestore();
    const other = isolated.authenticatedContext('visibility-visitor').firestore();
    const admin = isolated.authenticatedContext('visibility-admin', { role: 'admin' }).firestore();
    const anonymous = isolated.unauthenticatedContext().firestore();
    await assertSucceeds(setDoc(doc(owner, PATH), {
      uid: USER_ID, name: 'Perfil de Teste', email: 'owner@example.test',
      photoUrl: '', isProfileVisible: true,
      createdAt: serverTimestamp(), updatedAt: serverTimestamp(),
    }));
    const publicPath = PATH + '/public_profile/main';
    await assertSucceeds(setDoc(doc(owner, publicPath), {
      userId: USER_ID, name: 'Perfil de Teste', bio: 'Apresentação',
      photoUrl: '', updatedAt: serverTimestamp(),
    }));
    assert.equal((await assertSucceeds(getDoc(doc(owner, PATH)))).get('email'), 'owner@example.test');
    await assertFails(getDoc(doc(other, PATH)));
    await assertFails(getDoc(doc(admin, PATH)));
    await assertFails(getDoc(doc(anonymous, PATH)));
    await assertFails(getDocs(collection(other, 'users')));
    await assertFails(getDocs(query(collection(other, 'users'), where('isProfileVisible', '==', true))));
    await assertFails(getDocs(query(collection(other, 'users'), where('email', '==', 'owner@example.test'))));
    await assertFails(getDocs(query(collection(owner, 'users'), where('uid', '==', USER_ID))));
    await assertSucceeds(getDoc(doc(other, publicPath)));
    await assertSucceeds(updateDoc(doc(owner, PATH), { isProfileVisible: false, updatedAt: serverTimestamp() }));
    await assertFails(getDoc(doc(other, publicPath)));
    await assertSucceeds(getDoc(doc(owner, publicPath)));
    await assertFails(getDoc(doc(other, PATH)));
    // Subcollection grants remain independent of the account document.
    await isolated.withSecurityRulesDisabled(async context => {
      await setDoc(doc(context.firestore(), PATH + '/tasks/shared-note'), {
        sharedWith: ['visibility-visitor'], title: 'Nota compartilhada',
      });
      await setDoc(doc(context.firestore(), PATH + '/tasks/private-note'), {
        sharedWith: [], title: 'Nota privada',
      });
    });
    await assertSucceeds(getDoc(doc(other, PATH + '/tasks/shared-note')));
    await assertFails(getDoc(doc(other, PATH + '/tasks/private-note')));
    await assertSucceeds(getDoc(doc(owner, PATH + '/tasks/private-note')));

    // An invitation is scoped to its two participants, independently of
    // account visibility and without requiring any cross-account root read.
    const invitationId = USER_ID + '__shared-note__visibility-visitor';
    const invitationPath = 'note_invitations/' + invitationId;
    const stranger = isolated.authenticatedContext('visibility-stranger').firestore();
    await assertSucceeds(setDoc(doc(owner, invitationPath), {
      ownerId: USER_ID,
      ownerName: 'Perfil de Teste',
      ownerEmail: '',
      recipientId: 'visibility-visitor',
      recipientName: 'Kairubido',
      recipientEmail: '',
      recipientAvatar: '',
      noteId: 'shared-note',
      sourcePath: PATH + '/tasks/shared-note',
      noteUpdatedAtIso: '2026-11-26T00:00:00.000Z',
      status: 'pending',
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    }));
    const invitations = await assertSucceeds(getDocs(query(
      collection(other, 'note_invitations'), where('recipientId', '==', 'visibility-visitor')
    )));
    assert.equal(invitations.size, 1);
    await assertFails(getDoc(doc(stranger, invitationPath)));
    await assertFails(updateDoc(doc(stranger, invitationPath), {
      status: 'accepted', updatedAt: serverTimestamp(),
    }));
    await assertSucceeds(updateDoc(doc(other, invitationPath), {
      status: 'accepted', respondedAtIso: '2026-11-26T00:01:00.000Z',
      updatedAt: serverTimestamp(),
    }));
    assert.equal((await assertSucceeds(getDoc(doc(owner, invitationPath)))).get('status'), 'accepted');
    await assertSucceeds(updateDoc(doc(owner, PATH + '/tasks/shared-note'), { sharedWith: [] }));
    await assertSucceeds(updateDoc(doc(owner, invitationPath), {
      status: 'revoked', updatedAt: serverTimestamp(),
    }));
    await assertFails(getDoc(doc(other, PATH + '/tasks/shared-note')));
    await assertFails(getDoc(doc(other, PATH)));
    assert.equal((await assertSucceeds(getDoc(doc(other, invitationPath)))).get('status'), 'revoked');
  } finally {
    // This test shares the emulator project with other serial rule suites.
    // Restore the unmodified baseline even when a candidate assertion fails.
    await isolated.cleanup();
    const restored = await initializeTestEnvironment({
      projectId: PROJECT_ID,
      firestore: { rules: baseline, host: '127.0.0.1', port: 8088 },
    });
    await restored.cleanup();
  }
});
