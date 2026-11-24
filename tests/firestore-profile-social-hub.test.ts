import assert from 'node:assert/strict';
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

test('private chat history can only be cleared by each accepted participant', async () => {
  const alice='chat-alice', bob='chat-bob', connection='chat-test-connection';
  const a=environment.authenticatedContext(alice).firestore();
  const b=environment.authenticatedContext(bob).firestore();
  const stranger=environment.authenticatedContext('chat-stranger').firestore();
  const anon=environment.unauthenticatedContext().firestore();
  await environment.withSecurityRulesDisabled(async context=>{
    await setDoc(doc(context.firestore(),'connections',connection),{senderId:alice,receiverId:bob,participantIds:[alice,bob],status:'accepted'});
  });
  const old=doc(a,'social_chats',connection,'messages','old-message');
  await assertSucceeds(setDoc(old,{senderId:alice,receiverId:bob,text:'Antes',createdAt:serverTimestamp()}));
  const mark=doc(a,'social_chats',connection,'history_state',alice);
  await assertSucceeds(setDoc(mark,{clearedAt:serverTimestamp()}));
  const marker=await assertSucceeds(getDoc(mark));
  const oldMessage=await assertSucceeds(getDoc(doc(b,'social_chats',connection,'messages','old-message')));
  assert.ok(oldMessage.exists());
  assert.ok(oldMessage.get('createdAt').toMillis()<=marker.get('clearedAt').toMillis());
  await assertFails(getDoc(doc(b,'social_chats',connection,'history_state',alice)));
  await assertFails(setDoc(doc(b,'social_chats',connection,'history_state',alice),{clearedAt:serverTimestamp()}));
  await assertFails(setDoc(doc(stranger,'social_chats',connection,'history_state','chat-stranger'),{clearedAt:serverTimestamp()}));
  await assertFails(getDoc(doc(anon,'social_chats',connection,'history_state',alice)));
  await assertFails(deleteDoc(mark));
  await assertFails(setDoc(mark,{clearedAt:serverTimestamp(),extra:true}));
  await assertFails(deleteDoc(old));
  const next=doc(b,'social_chats',connection,'messages','new-message');
  await assertSucceeds(setDoc(next,{senderId:bob,receiverId:alice,text:'Depois',createdAt:serverTimestamp()}));
  const newMessage=await assertSucceeds(getDoc(doc(a,'social_chats',connection,'messages','new-message')));
  assert.ok(newMessage.get('createdAt').toMillis()>=marker.get('clearedAt').toMillis());
  await assertSucceeds(setDoc(doc(b,'social_chats',connection,'history_state',bob),{clearedAt:serverTimestamp()}));
  await assertSucceeds(getDoc(mark));
});
