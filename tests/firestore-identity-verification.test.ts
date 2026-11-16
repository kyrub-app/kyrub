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


test('approved freelancer can request bike courier review without losing existing approval', async () => {
  await environment.withSecurityRulesDisabled(async context => {
    await setDoc(doc(context.firestore(), 'identity_verifications', 'user_a'), {
      ...verification('user_a'),
      status: 'approved',
      requestedProfiles: ['freelancer'],
      approvedProfiles: ['freelancer'],
      reviewedBy: 'compliance_a',
      reviewedAt: Timestamp.fromMillis(1_700_000_000_000),
      createdAt: Timestamp.fromMillis(1_700_000_000_000),
      submittedAt: Timestamp.fromMillis(1_700_000_000_000),
      updatedAt: Timestamp.fromMillis(1_700_000_000_000),
    });
  });
  const owner = environment.authenticatedContext('user_a').firestore();
  const profile = doc(owner, 'identity_verifications', 'user_a');
  await assertSucceeds(updateDoc(profile, {
    profileExpansion: {
      profile: 'bicycle_courier',
      status: 'submitted',
      documentPaths: [],
      cnhCategory: '',
      cnhHasEar: false,
      submittedAt: serverTimestamp(),
      reviewedAt: null,
      reviewedBy: '',
      reviewReason: '',
    },
    updatedAt: serverTimestamp(),
  }));
  const requested = (await getDoc(profile)).data();
  if (!requested) throw new Error('Missing verification record');
  if (requested.status !== 'approved' || requested.approvedProfiles[0] !== 'freelancer') {
    throw new Error('Previous approval was altered');
  }
  await assertFails(updateDoc(profile, {
    approvedProfiles: ['freelancer', 'bicycle_courier'],
    'profileExpansion.status': 'approved',
    updatedAt: serverTimestamp(),
  }));
  const outsider = environment.authenticatedContext('user_b').firestore();
  await assertFails(getDoc(doc(outsider, 'identity_verifications', 'user_a')));

  const admin = environment.authenticatedContext('compliance_a').firestore();
  await assertSucceeds(updateDoc(doc(admin, 'identity_verifications', 'user_a'), {
    approvedProfiles: ['freelancer', 'bicycle_courier'],
    requestedProfiles: ['freelancer', 'bicycle_courier'],
    'profileExpansion.status': 'approved',
    'profileExpansion.reviewReason': '',
    'profileExpansion.reviewedBy': 'compliance_a',
    'profileExpansion.reviewedAt': serverTimestamp(),
    updatedAt: serverTimestamp(),
  }));
  const approved = (await getDoc(profile)).data();
  if (approved?.approvedProfiles.join(',') !== 'freelancer,bicycle_courier' || approved.status !== 'approved') {
    throw new Error('Profile expansion did not preserve earlier approval');
  }
  await assertFails(updateDoc(profile, {
    profileExpansion: {
      profile: 'bicycle_courier',
      status: 'submitted',
      documentPaths: [],
      cnhCategory: '',
      cnhHasEar: false,
      submittedAt: serverTimestamp(),
      reviewedAt: null,
      reviewedBy: '',
      reviewReason: '',
    },
    updatedAt: serverTimestamp(),
  }));
});

test('rejected expansion preserves approved freelancer and can be corrected; motorized needs CNH evidence', async () => {
  await environment.withSecurityRulesDisabled(async context => {
    await setDoc(doc(context.firestore(), 'identity_verifications', 'user_a'), {
      ...verification('user_a'),
      status: 'approved',
      requestedProfiles: ['freelancer'],
      approvedProfiles: ['freelancer'],
      reviewedBy: 'compliance_a',
      reviewedAt: Timestamp.fromMillis(1_700_000_000_000),
      createdAt: Timestamp.fromMillis(1_700_000_000_000),
      submittedAt: Timestamp.fromMillis(1_700_000_000_000),
      updatedAt: Timestamp.fromMillis(1_700_000_000_000),
    });
  });
  const owner = environment.authenticatedContext('user_a').firestore();
  const profile = doc(owner, 'identity_verifications', 'user_a');
  const request = {
    profile: 'motorized_courier',
    status: 'submitted',
    documentPaths: [],
    cnhCategory: 'A',
    cnhHasEar: true,
    submittedAt: serverTimestamp(),
    reviewedAt: null,
    reviewedBy: '',
    reviewReason: '',
  };
  await assertFails(updateDoc(profile, { profileExpansion: request, updatedAt: serverTimestamp() }));
  await assertSucceeds(updateDoc(profile, {
    profileExpansion: {
      ...request,
      documentPaths: ['identity-verification/user_a/document/cnh.jpg'],
    },
    updatedAt: serverTimestamp(),
  }));
  const admin = environment.authenticatedContext('compliance_a').firestore();
  await assertSucceeds(updateDoc(doc(admin, 'identity_verifications', 'user_a'), {
    'profileExpansion.status': 'rejected',
    'profileExpansion.reviewReason': 'Documento ilegível',
    'profileExpansion.reviewedBy': 'compliance_a',
    'profileExpansion.reviewedAt': serverTimestamp(),
    updatedAt: serverTimestamp(),
  }));
  const rejected = (await getDoc(profile)).data();
  if (rejected?.status !== 'approved' || rejected.approvedProfiles.join(',') !== 'freelancer') {
    throw new Error('Rejection incorrectly revoked freelancer approval');
  }
  await assertSucceeds(updateDoc(profile, {
    profileExpansion: {
      ...request,
      documentPaths: ['identity-verification/user_a/document/cnh-new.jpg'],
    },
    updatedAt: serverTimestamp(),
  }));
});
