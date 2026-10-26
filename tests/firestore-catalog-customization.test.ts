import { readFileSync } from 'node:fs';
import { after, before, beforeEach, test } from 'node:test';
import {
  assertFails,
  assertSucceeds,
  initializeTestEnvironment,
  type RulesTestEnvironment,
} from '@firebase/rules-unit-testing';
import { collection, deleteDoc, doc, getDoc, getDocs, serverTimestamp, setDoc, updateDoc } from 'firebase/firestore';

const PROJECT_ID = 'kyrub-security-test';
const OWNER_ID = 'catalog-owner';
const PATH = `users/${OWNER_ID}/private_store/catalog_customization`;
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

beforeEach(async () => { await environment.clearFirestore(); });
after(async () => { await environment.cleanup(); });

const payload = () => ({
  ownerId: OWNER_ID,
  catalogCustomizationDefaults: [{ path: 'Alimentação > Lanches', quickNotes: ['Sem cebola'], optionGroups: [] }],
  createdAt: serverTimestamp(),
  updatedAt: serverTimestamp(),
});

test('owner can create, read and update private catalog defaults', async () => {
  const owner = environment.authenticatedContext(OWNER_ID).firestore();
  await assertSucceeds(setDoc(doc(owner, PATH), payload()));
  await assertSucceeds(getDoc(doc(owner, PATH)));
  await assertSucceeds(updateDoc(doc(owner, PATH), {
    catalogCustomizationDefaults: [], updatedAt: serverTimestamp(),
  }));
});

test('other users cannot read or change private catalog defaults', async () => {
  const owner = environment.authenticatedContext(OWNER_ID).firestore();
  const other = environment.authenticatedContext('other-user').firestore();
  await assertSucceeds(setDoc(doc(owner, PATH), payload()));
  await assertFails(getDoc(doc(other, PATH)));
  await assertFails(updateDoc(doc(other, PATH), {
    catalogCustomizationDefaults: [], updatedAt: serverTimestamp(),
  }));
});

test('owner cannot change identity, creation date or delete private defaults', async () => {
  const owner = environment.authenticatedContext(OWNER_ID).firestore();
  await assertSucceeds(setDoc(doc(owner, PATH), payload()));
  await assertFails(updateDoc(doc(owner, PATH), { ownerId: 'other-user', updatedAt: serverTimestamp() }));
  await assertFails(updateDoc(doc(owner, PATH), { createdAt: serverTimestamp(), updatedAt: serverTimestamp() }));
  await assertFails(deleteDoc(doc(owner, PATH)));
});


test('anonymous users cannot read private catalog defaults', async () => {
  const owner = environment.authenticatedContext(OWNER_ID).firestore();
  const guest = environment.unauthenticatedContext().firestore();
  await assertSucceeds(setDoc(doc(owner, PATH), payload()));
  await assertFails(getDoc(doc(guest, PATH)));
});

test('owner cannot list private_store documents', async () => {
  const owner = environment.authenticatedContext(OWNER_ID).firestore();
  await assertSucceeds(setDoc(doc(owner, PATH), payload()));
  await assertFails(getDocs(collection(owner, `users/${OWNER_ID}/private_store`)));
});

test('rejects oversized private catalog defaults', async () => {
  const owner = environment.authenticatedContext(OWNER_ID).firestore();
  const oversized = Array.from({ length: 201 }, (_, index) => ({
    path: `Alimentação > Grupo ${index}`, quickNotes: [], optionGroups: [],
  }));
  await assertFails(setDoc(doc(owner, PATH), {
    ...payload(), catalogCustomizationDefaults: oversized,
  }));
});
