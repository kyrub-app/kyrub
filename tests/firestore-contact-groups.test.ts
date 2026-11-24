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
const OWNER_ID = 'group-owner';
const GROUP_ID = 'family_group';
const GROUP_PATH = `users/${OWNER_ID}/contact_groups/${GROUP_ID}`;
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

const groupPayload = () => ({
  groupId: GROUP_ID,
  ownerId: OWNER_ID,
  name: 'Família',
  memberIds: ['connected-user-1'],
  createdAt: serverTimestamp(),
  updatedAt: serverTimestamp(),
});

test('owner creates, reads, updates and deletes a private contact group', async () => {
  const owner = environment.authenticatedContext(OWNER_ID).firestore();
  await assertSucceeds(setDoc(doc(owner, GROUP_PATH), groupPayload()));
  await assertSucceeds(getDoc(doc(owner, GROUP_PATH)));
  await assertSucceeds(
    updateDoc(doc(owner, GROUP_PATH), {
      name: 'Família próxima',
      memberIds: ['connected-user-1', 'connected-user-2'],
      updatedAt: serverTimestamp(),
    })
  );
  await assertSucceeds(deleteDoc(doc(owner, GROUP_PATH)));
});

test('another authenticated user cannot read or mutate the group', async () => {
  const owner = environment.authenticatedContext(OWNER_ID).firestore();
  const outsider = environment.authenticatedContext('group-outsider').firestore();
  await assertSucceeds(setDoc(doc(owner, GROUP_PATH), groupPayload()));
  await assertFails(getDoc(doc(outsider, GROUP_PATH)));
  await assertFails(
    updateDoc(doc(outsider, GROUP_PATH), {
      name: 'Alteração indevida',
      updatedAt: serverTimestamp(),
    })
  );
  await assertFails(deleteDoc(doc(outsider, GROUP_PATH)));
});

test('invalid group shapes and unauthenticated access are rejected', async () => {
  const owner = environment.authenticatedContext(OWNER_ID).firestore();
  const visitor = environment.unauthenticatedContext().firestore();
  await assertFails(
    setDoc(doc(owner, GROUP_PATH), {
      ...groupPayload(),
      name: 'x'.repeat(61),
    })
  );
  await assertFails(
    setDoc(doc(owner, GROUP_PATH), {
      ...groupPayload(),
      ownerId: 'another-owner',
    })
  );
  await assertFails(
    setDoc(doc(owner, GROUP_PATH), {
      ...groupPayload(),
      memberIds: Array.from({ length: 201 }, (_, index) => `user-${index}`),
    })
  );
  await assertFails(getDoc(doc(visitor, GROUP_PATH)));
});

test('favorites are private, persistent and require an accepted connection to that contact',async()=>{
 const owner=environment.authenticatedContext(OWNER_ID).firestore();
 const peer=environment.authenticatedContext('contact-peer').firestore();
 const path='users/'+OWNER_ID+'/contact_favorites/contact-peer';
 const payload=()=>({connectionId:'favorite-pair',favorited:true,updatedAt:serverTimestamp()});
 await assertFails(setDoc(doc(owner,path),payload()));
 await environment.withSecurityRulesDisabled(async context=>{
  await setDoc(doc(context.firestore(),'connections/favorite-pair'),{senderId:OWNER_ID,receiverId:'contact-peer',participantIds:[OWNER_ID,'contact-peer'],status:'accepted'});
 });
 await assertSucceeds(setDoc(doc(owner,path),payload()));
 await assertSucceeds(getDoc(doc(owner,path)));
 await assertFails(getDoc(doc(peer,path)));
 await assertFails(setDoc(doc(peer,path),payload()));
 await assertFails(setDoc(doc(owner,'users/'+OWNER_ID+'/contact_favorites/unrelated'),payload()));
 await assertFails(setDoc(doc(owner,path),{...payload(),secret:'unexpected'}));
 await assertSucceeds(deleteDoc(doc(owner,path)));
});
