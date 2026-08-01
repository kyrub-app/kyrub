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
  limit,
  query,
  serverTimestamp,
  setDoc,
  Timestamp,
  updateDoc,
} from 'firebase/firestore';

const PROJECT_ID = 'kyrub-security-test';
let environment: RulesTestEnvironment;

const verification = (uid: string, status: 'draft' | 'submitted' = 'submitted') => ({
  uid,
  status,
  requestedProfiles: ['freelancer', 'bicycle_courier'],
  approvedProfiles: [],
  fullName: 'Pessoa Teste',
  cpf: '52998224725',
  address: 'Rua Teste, 100, São Paulo - SP',
  whatsapp: '11999999999',
  documentType: 'cin',
  documentPaths: [`identity-verification/${uid}/document/id.jpg`],
  selfiePath: `identity-verification/${uid}/selfie/selfie.jpg`,
  cnhCategory: '',
  cnhHasEar: false,
  consentVersion: '2026-08-01',
  reviewReason: '',
  reviewedBy: '',
  reviewedAt: null,
  submittedAt: status === 'submitted' ? serverTimestamp() : null,
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

test('the owner can submit and read only their own verification', async () => {
  const owner = environment.authenticatedContext('user_a').firestore();
  await assertSucceeds(
    setDoc(doc(owner, 'identity_verifications', 'user_a'), verification('user_a'))
  );
  await assertSucceeds(
    getDoc(doc(owner, 'identity_verifications', 'user_a'))
  );

  const outsider = environment.authenticatedContext('user_b').firestore();
  await assertFails(
    getDoc(doc(outsider, 'identity_verifications', 'user_a'))
  );
});

test('the owner cannot approve themselves or change protected review fields', async () => {
  await environment.withSecurityRulesDisabled(async context => {
    await setDoc(
      doc(context.firestore(), 'identity_verifications', 'user_a'),
      {
        ...verification('user_a'),
        createdAt: Timestamp.fromMillis(1_700_000_000_000),
        submittedAt: Timestamp.fromMillis(1_700_000_000_000),
        updatedAt: Timestamp.fromMillis(1_700_000_000_000),
      }
    );
  });

  const owner = environment.authenticatedContext('user_a').firestore();
  await assertFails(
    updateDoc(doc(owner, 'identity_verifications', 'user_a'), {
      status: 'approved',
      approvedProfiles: ['freelancer'],
      reviewedBy: 'user_a',
      reviewedAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    })
  );
});

test('compliance can review a bounded list and approve requested profiles', async () => {
  await environment.withSecurityRulesDisabled(async context => {
    await setDoc(
      doc(context.firestore(), 'identity_verifications', 'user_a'),
      {
        ...verification('user_a'),
        createdAt: Timestamp.fromMillis(1_700_000_000_000),
        submittedAt: Timestamp.fromMillis(1_700_000_000_000),
        updatedAt: Timestamp.fromMillis(1_700_000_000_000),
      }
    );
  });

  const compliance = environment.authenticatedContext('compliance_a').firestore();
  await assertSucceeds(
    getDocs(query(collection(compliance, 'identity_verifications'), limit(100)))
  );
  await assertSucceeds(
    updateDoc(doc(compliance, 'identity_verifications', 'user_a'), {
      status: 'approved',
      approvedProfiles: ['freelancer', 'bicycle_courier'],
      reviewReason: '',
      reviewedBy: 'compliance_a',
      reviewedAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    })
  );

  const owner = environment.authenticatedContext('user_a').firestore();
  await assertFails(
    updateDoc(doc(owner, 'identity_verifications', 'user_a'), {
      address: 'Outro endereço',
      updatedAt: serverTimestamp(),
    })
  );
});
