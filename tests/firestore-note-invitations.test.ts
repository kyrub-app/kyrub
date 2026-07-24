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
  doc,
  getDoc,
  getDocs,
  query,
  serverTimestamp,
  setDoc,
  updateDoc,
  where,
} from 'firebase/firestore';

const PROJECT_ID = 'kyrub-security-test';
const OWNER_ID = 'note-owner';
const RECIPIENT_ID = 'note-recipient';
const NOTE_ID = 'note-123';
const INVITATION_ID = `${OWNER_ID}__${NOTE_ID}__${RECIPIENT_ID}`;
let environment: RulesTestEnvironment;

const invitationPayload = () => ({
  ownerId: OWNER_ID,
  ownerName: 'Proprietário',
  ownerEmail: 'owner@example.com',
  recipientId: RECIPIENT_ID,
  recipientName: 'Destinatário',
  recipientEmail: 'recipient@example.com',
  recipientAvatar: '',
  noteId: NOTE_ID,
  sourcePath: `users/${OWNER_ID}/tasks/${NOTE_ID}`,
  noteUpdatedAtIso: '2026-07-24T12:00:00.000Z',
  status: 'pending',
  createdAt: serverTimestamp(),
  updatedAt: serverTimestamp(),
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

test('owner creates a direct note invitation and recipient lists it', async () => {
  const owner = environment.authenticatedContext(OWNER_ID).firestore();
  await assertSucceeds(
    setDoc(
      doc(owner, 'note_invitations', INVITATION_ID),
      invitationPayload()
    )
  );

  const recipient = environment
    .authenticatedContext(RECIPIENT_ID)
    .firestore();
  const invitations = await assertSucceeds(
    getDocs(
      query(
        collection(recipient, 'note_invitations'),
        where('recipientId', '==', RECIPIENT_ID)
      )
    )
  );

  if (invitations.size !== 1) {
    throw new Error(`Expected one invitation, received ${invitations.size}.`);
  }
});

test('recipient accepts only their own pending invitation', async () => {
  await environment.withSecurityRulesDisabled(async context => {
    await setDoc(
      doc(context.firestore(), 'note_invitations', INVITATION_ID),
      {
        ...invitationPayload(),
        createdAt: new Date('2026-07-24T12:00:00.000Z'),
        updatedAt: new Date('2026-07-24T12:00:00.000Z'),
      }
    );
  });

  const recipient = environment
    .authenticatedContext(RECIPIENT_ID)
    .firestore();
  await assertSucceeds(
    updateDoc(doc(recipient, 'note_invitations', INVITATION_ID), {
      status: 'accepted',
      respondedAtIso: '2026-07-24T12:05:00.000Z',
      updatedAt: serverTimestamp(),
    })
  );

  await assertFails(
    updateDoc(doc(recipient, 'note_invitations', INVITATION_ID), {
      ownerName: 'Nome adulterado',
      updatedAt: serverTimestamp(),
    })
  );
});

test('unrelated users cannot read or alter a note invitation', async () => {
  await environment.withSecurityRulesDisabled(async context => {
    await setDoc(
      doc(context.firestore(), 'note_invitations', INVITATION_ID),
      {
        ...invitationPayload(),
        createdAt: new Date('2026-07-24T12:00:00.000Z'),
        updatedAt: new Date('2026-07-24T12:00:00.000Z'),
      }
    );
  });

  const stranger = environment.authenticatedContext('stranger').firestore();
  await assertFails(
    getDoc(doc(stranger, 'note_invitations', INVITATION_ID))
  );
  await assertFails(
    updateDoc(doc(stranger, 'note_invitations', INVITATION_ID), {
      status: 'accepted',
      respondedAtIso: '2026-07-24T12:05:00.000Z',
      updatedAt: serverTimestamp(),
    })
  );
});

test('owner may revoke an invitation after removing the collaborator', async () => {
  await environment.withSecurityRulesDisabled(async context => {
    await setDoc(
      doc(context.firestore(), 'note_invitations', INVITATION_ID),
      {
        ...invitationPayload(),
        createdAt: new Date('2026-07-24T12:00:00.000Z'),
        updatedAt: new Date('2026-07-24T12:00:00.000Z'),
      }
    );
  });

  const owner = environment.authenticatedContext(OWNER_ID).firestore();
  await assertSucceeds(
    updateDoc(doc(owner, 'note_invitations', INVITATION_ID), {
      status: 'revoked',
      updatedAt: serverTimestamp(),
    })
  );
});
