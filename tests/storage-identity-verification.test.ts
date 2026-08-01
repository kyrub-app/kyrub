import { readFileSync } from 'node:fs';
import { after, before, beforeEach, test } from 'node:test';
import {
  assertFails,
  assertSucceeds,
  initializeTestEnvironment,
  type RulesTestEnvironment,
} from '@firebase/rules-unit-testing';
import { doc, setDoc, Timestamp } from 'firebase/firestore';
import {
  deleteObject,
  getBytes,
  ref,
  uploadBytes,
} from 'firebase/storage';

const PROJECT_ID = 'kyrub-identity-security-test';
let environment: RulesTestEnvironment;

const metadata = (
  ownerId: string,
  purpose: 'document' | 'selfie'
) => ({
  contentType: 'image/jpeg',
  customMetadata: {
    ownerId,
    purpose,
    consentVersion: '2026-08-01',
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
  await environment.withSecurityRulesDisabled(async context => {
    await setDoc(
      doc(
        context.firestore(),
        'kyrub_admin',
        'control_plane',
        'admins',
        'compliance_a'
      ),
      {
        uid: 'compliance_a',
        email: 'compliance@example.com',
        displayName: 'Compliance',
        role: 'compliance',
        status: 'active',
        createdBy: 'bootstrap_admin',
        createdAt: Timestamp.fromMillis(1_700_000_000_000),
        updatedAt: Timestamp.fromMillis(1_700_000_000_000),
        suspendedAt: '',
        revokedAt: '',
      }
    );
  });
});

after(async () => {
  await environment.cleanup();
});

test('the owner can upload and read a private identity document', async () => {
  const ownerStorage = environment.authenticatedContext('user_a').storage();
  const document = ref(
    ownerStorage,
    'identity-verification/user_a/document/identity.jpg'
  );

  await assertSucceeds(
    uploadBytes(document, new Uint8Array([1, 2, 3]), metadata('user_a', 'document'))
  );
  await assertSucceeds(getBytes(document));
});

test('another user cannot read or write the owner identity files', async () => {
  const ownerStorage = environment.authenticatedContext('user_a').storage();
  const path = 'identity-verification/user_a/document/identity.jpg';
  await assertSucceeds(
    uploadBytes(ref(ownerStorage, path), new Uint8Array([1]), metadata('user_a', 'document'))
  );

  const outsiderStorage = environment.authenticatedContext('user_b').storage();
  await assertFails(getBytes(ref(outsiderStorage, path)));
  await assertFails(
    uploadBytes(
      ref(outsiderStorage, 'identity-verification/user_a/document/forged.jpg'),
      new Uint8Array([2]),
      metadata('user_a', 'document')
    )
  );
});

test('active compliance can read but cannot replace or delete identity files', async () => {
  const ownerStorage = environment.authenticatedContext('user_a').storage();
  const path = 'identity-verification/user_a/selfie/selfie.jpg';
  await assertSucceeds(
    uploadBytes(ref(ownerStorage, path), new Uint8Array([1]), metadata('user_a', 'selfie'))
  );

  const complianceStorage = environment
    .authenticatedContext('compliance_a')
    .storage();
  await assertSucceeds(getBytes(ref(complianceStorage, path)));
  await assertFails(
    uploadBytes(
      ref(complianceStorage, path),
      new Uint8Array([9]),
      metadata('user_a', 'selfie')
    )
  );
  await assertFails(deleteObject(ref(complianceStorage, path)));
});

test('uploads reject forged metadata and invalid selfie file types', async () => {
  const ownerStorage = environment.authenticatedContext('user_a').storage();

  await assertFails(
    uploadBytes(
      ref(ownerStorage, 'identity-verification/user_a/document/forged.jpg'),
      new Uint8Array([1]),
      metadata('user_b', 'document')
    )
  );

  await assertFails(
    uploadBytes(
      ref(ownerStorage, 'identity-verification/user_a/selfie/selfie.pdf'),
      new Uint8Array([1]),
      {
        contentType: 'application/pdf',
        customMetadata: {
          ownerId: 'user_a',
          purpose: 'selfie',
          consentVersion: '2026-08-01',
        },
      }
    )
  );
});

test('clients cannot delete identity verification evidence', async () => {
  const ownerStorage = environment.authenticatedContext('user_a').storage();
  const document = ref(
    ownerStorage,
    'identity-verification/user_a/document/identity.jpg'
  );
  await assertSucceeds(
    uploadBytes(document, new Uint8Array([1]), metadata('user_a', 'document'))
  );
  await assertFails(deleteObject(document));
});
