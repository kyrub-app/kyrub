import { readFileSync } from 'node:fs';
import { after, before, beforeEach, test } from 'node:test';
import {
  assertFails,
  assertSucceeds,
  initializeTestEnvironment,
  type RulesTestEnvironment,
} from '@firebase/rules-unit-testing';
import {
  deleteObject,
  getBytes,
  ref,
  uploadBytes,
} from 'firebase/storage';

const PROJECT_ID = 'kyrub-identity-security-test';
let environment: RulesTestEnvironment;

const attachmentMetadata = (
  ownerId: string,
  conversationId: string,
  attachmentId: string,
  contentType: string
) => ({
  contentType,
  customMetadata: {
    ownerId,
    conversationId,
    attachmentId,
    purpose: 'kyrubia-conversation',
    originalName: contentType === 'application/pdf' ? 'catalogo.pdf' : 'foto.jpg',
  },
});

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
});

after(async () => {
  await environment.cleanup();
});

test('owner can upload, read and delete a private Kyrubia image attachment', async () => {
  const ownerStorage = environment.authenticatedContext('user_a').storage();
  const path = 'kyrubia-attachments/user_a/conversation_a/att_image';
  const attachment = ref(ownerStorage, path);

  await assertSucceeds(
    uploadBytes(
      attachment,
      new Uint8Array([1, 2, 3]),
      attachmentMetadata('user_a', 'conversation_a', 'att_image', 'image/jpeg')
    )
  );
  await assertSucceeds(getBytes(attachment));
  await assertSucceeds(deleteObject(attachment));
});

test('owner can upload and read a private Kyrubia PDF attachment', async () => {
  const ownerStorage = environment.authenticatedContext('user_a').storage();
  const attachment = ref(
    ownerStorage,
    'kyrubia-attachments/user_a/conversation_pdf/att_pdf'
  );

  await assertSucceeds(
    uploadBytes(
      attachment,
      new Uint8Array([37, 80, 68, 70]),
      attachmentMetadata('user_a', 'conversation_pdf', 'att_pdf', 'application/pdf')
    )
  );
  await assertSucceeds(getBytes(attachment));
});

test('another user cannot read, write or delete owner Kyrubia attachments', async () => {
  const ownerStorage = environment.authenticatedContext('user_a').storage();
  const path = 'kyrubia-attachments/user_a/conversation_a/att_private';
  await assertSucceeds(
    uploadBytes(
      ref(ownerStorage, path),
      new Uint8Array([1]),
      attachmentMetadata('user_a', 'conversation_a', 'att_private', 'image/png')
    )
  );

  const outsiderStorage = environment.authenticatedContext('user_b').storage();
  await assertFails(getBytes(ref(outsiderStorage, path)));
  await assertFails(deleteObject(ref(outsiderStorage, path)));
  await assertFails(
    uploadBytes(
      ref(outsiderStorage, 'kyrubia-attachments/user_a/conversation_a/att_forged'),
      new Uint8Array([2]),
      attachmentMetadata('user_a', 'conversation_a', 'att_forged', 'image/png')
    )
  );
});

test('Kyrubia attachment uploads reject forged binding metadata', async () => {
  const ownerStorage = environment.authenticatedContext('user_a').storage();
  const path = 'kyrubia-attachments/user_a/conversation_a/att_bound';

  await assertFails(
    uploadBytes(
      ref(ownerStorage, path),
      new Uint8Array([1]),
      attachmentMetadata('user_b', 'conversation_a', 'att_bound', 'image/jpeg')
    )
  );
  await assertFails(
    uploadBytes(
      ref(ownerStorage, path),
      new Uint8Array([1]),
      attachmentMetadata('user_a', 'conversation_b', 'att_bound', 'image/jpeg')
    )
  );
  await assertFails(
    uploadBytes(
      ref(ownerStorage, path),
      new Uint8Array([1]),
      attachmentMetadata('user_a', 'conversation_a', 'att_other', 'image/jpeg')
    )
  );
});

test('Kyrubia attachment uploads reject unsupported MIME types and overwrites', async () => {
  const ownerStorage = environment.authenticatedContext('user_a').storage();
  const invalid = ref(
    ownerStorage,
    'kyrubia-attachments/user_a/conversation_a/att_text'
  );
  await assertFails(
    uploadBytes(
      invalid,
      new Uint8Array([1]),
      attachmentMetadata('user_a', 'conversation_a', 'att_text', 'text/plain')
    )
  );

  const stable = ref(
    ownerStorage,
    'kyrubia-attachments/user_a/conversation_a/att_stable'
  );
  const metadata = attachmentMetadata(
    'user_a',
    'conversation_a',
    'att_stable',
    'image/webp'
  );
  await assertSucceeds(uploadBytes(stable, new Uint8Array([1]), metadata));
  await assertFails(uploadBytes(stable, new Uint8Array([2]), metadata));
});
