import { readFileSync } from 'node:fs';
import { after, before, beforeEach, test } from 'node:test';
import {
  assertFails,
  assertSucceeds,
  initializeTestEnvironment,
  type RulesTestEnvironment,
} from '@firebase/rules-unit-testing';
import {
  collection,
  deleteDoc,
  doc,
  getDoc,
  getDocs,
  serverTimestamp,
  setDoc,
} from 'firebase/firestore';

const PROJECT_ID = 'kyrub-security-test';
const OWNER_ID = 'kyrubia-history-owner';
const STRANGER_ID = 'kyrubia-history-stranger';
const CONVERSATION_ID = 'conversation-123';
let environment: RulesTestEnvironment;

const payload = (uid = OWNER_ID) => ({
  uid,
  conversationId: CONVERSATION_ID,
  updatedAt: '2026-08-23T01:00:00.000Z',
  conversation: {
    id: CONVERSATION_ID,
    title: 'Estoque de exemplo',
    topic: 'Estoque',
    createdAt: '2026-08-23T00:59:00.000Z',
    updatedAt: '2026-08-23T01:00:00.000Z',
    messages: [
      {
        id: 'message-1',
        role: 'user',
        content: 'Quanto tenho em estoque?',
        createdAt: '2026-08-23T01:00:00.000Z',
        attachments: [],
      },
    ],
  },
  syncedAt: serverTimestamp(),
});

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

test('user can create, list, read and delete only their own Kyrubia history', async () => {
  const owner = environment.authenticatedContext(OWNER_ID).firestore();
  const ref = doc(owner, 'users', OWNER_ID, 'kyrubiaConversations', CONVERSATION_ID);

  await assertSucceeds(setDoc(ref, payload()));
  await assertSucceeds(getDoc(ref));
  const list = await assertSucceeds(
    getDocs(collection(owner, 'users', OWNER_ID, 'kyrubiaConversations'))
  );
  if (list.size !== 1) throw new Error(`Expected 1 conversation, got ${list.size}.`);
  await assertSucceeds(deleteDoc(ref));
});

test('another authenticated user cannot read, list, write or delete someone else history', async () => {
  const stranger = environment.authenticatedContext(STRANGER_ID).firestore();
  const ref = doc(stranger, 'users', OWNER_ID, 'kyrubiaConversations', CONVERSATION_ID);

  await assertFails(setDoc(ref, payload(STRANGER_ID)));
  await assertFails(getDoc(ref));
  await assertFails(
    getDocs(collection(stranger, 'users', OWNER_ID, 'kyrubiaConversations'))
  );
  await assertFails(deleteDoc(ref));
});

test('owner cannot forge the uid or conversation identity inside the envelope', async () => {
  const owner = environment.authenticatedContext(OWNER_ID).firestore();
  const ref = doc(owner, 'users', OWNER_ID, 'kyrubiaConversations', CONVERSATION_ID);

  await assertFails(setDoc(ref, payload('different-user')));
  await assertFails(setDoc(ref, {
    ...payload(),
    conversation: {
      ...payload().conversation,
      id: 'different-conversation',
    },
  }));
});
