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
  deleteDoc,
  getDoc,
  getDocs,
  limit,
  query,
  where,
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


const motofreteDocuments = (uid: string) => ({
  course: `identity-verification/${uid}/document/course.pdf`,
  vehicle: `identity-verification/${uid}/document/crlv.pdf`,
  inspection: `identity-verification/${uid}/document/inspection.pdf`,
  equipment: `identity-verification/${uid}/document/equipment.jpg`,
  local: '',
});

const motofreteRequest = (uid: string) => ({
  status: 'submitted',
  documents: motofreteDocuments(uid),
  submittedAt: serverTimestamp(),
  reviewedAt: null,
  reviewedBy: '',
  reviewReason: '',
  courseVerified: false,
  minimumAgeAndLicenseTenureVerified: false,
  vehicleRegistrationAndAuthorizationVerified: false,
  safetyEquipmentVerified: false,
  semiannualInspectionVerified: false,
  localRequirementsVerified: false,
  validUntil: null,
});

const approvedMotofreteFields = () => ({
  'motofreteQualification.status': 'approved',
  'motofreteQualification.reviewedBy': 'compliance_a',
  'motofreteQualification.reviewedAt': serverTimestamp(),
  'motofreteQualification.reviewReason': '',
  'motofreteQualification.courseVerified': true,
  'motofreteQualification.minimumAgeAndLicenseTenureVerified': true,
  'motofreteQualification.vehicleRegistrationAndAuthorizationVerified': true,
  'motofreteQualification.safetyEquipmentVerified': true,
  'motofreteQualification.semiannualInspectionVerified': true,
  'motofreteQualification.localRequirementsVerified': true,
  'motofreteQualification.validUntil': Timestamp.fromMillis(Date.now() + 30 * 24 * 60 * 60 * 1000),
  updatedAt: serverTimestamp(),
});

const seedApprovedMotorized = async (uid: string = 'user_a') => {
  await environment.withSecurityRulesDisabled(async context => {
    await setDoc(doc(context.firestore(), 'identity_verifications', uid), {
      ...verification(uid),
      status: 'approved',
      requestedProfiles: ['motorized_courier'],
      approvedProfiles: ['motorized_courier'],
      documentType: 'cnh',
      cnhCategory: 'A',
      cnhHasEar: true,
      reviewedBy: 'compliance_a',
      reviewedAt: Timestamp.fromMillis(1_700_000_000_000),
      createdAt: Timestamp.fromMillis(1_700_000_000_000),
      submittedAt: Timestamp.fromMillis(1_700_000_000_000),
      updatedAt: Timestamp.fromMillis(1_700_000_000_000),
    });
  });
};

test('approved motorized courier submits private motofrete evidence but cannot self-certify', async () => {
  await seedApprovedMotorized();
  const owner = environment.authenticatedContext('user_a').firestore();
  const record = doc(owner, 'identity_verifications', 'user_a');

  await assertFails(updateDoc(record, {
    motofreteQualification: { ...motofreteRequest('user_a'), documents: {
      ...motofreteDocuments('user_a'),
      course: 'identity-verification/user_b/document/forged.pdf',
    } },
    updatedAt: serverTimestamp(),
  }));
  await assertFails(updateDoc(record, {
    motofreteQualification: { ...motofreteRequest('user_a'), documents: {
      ...motofreteDocuments('user_a'),
      inspection: '',
    } },
    updatedAt: serverTimestamp(),
  }));
  await assertSucceeds(updateDoc(record, {
    motofreteQualification: motofreteRequest('user_a'),
    updatedAt: serverTimestamp(),
  }));
  const saved = (await getDoc(record)).data();
  if (!saved || saved.status !== 'approved'
    || saved.approvedProfiles.join(',') !== 'motorized_courier'
    || saved.motofreteQualification?.status !== 'submitted') {
    throw new Error('Existing motorized approval or submission was altered');
  }

  await assertFails(updateDoc(record, {
    ...approvedMotofreteFields(),
    'motofreteQualification.reviewedBy': 'user_a',
  }));
  await assertFails(updateDoc(record, {
    'motofreteQualification.documents.course': 'identity-verification/user_a/document/fake.pdf',
    updatedAt: serverTimestamp(),
  }));
  await assertFails(updateDoc(record, {
    'motofreteQualification.validUntil': Timestamp.fromMillis(Date.now() + 86_400_000),
    updatedAt: serverTimestamp(),
  }));
  await assertFails(updateDoc(record, {
    approvedProfiles: ['motorized_courier','bicycle_courier'],
    updatedAt: serverTimestamp(),
  }));

  const outsider = environment.authenticatedContext('user_b').firestore();
  await assertFails(getDoc(doc(outsider, 'identity_verifications', 'user_a')));
});

test('motofrete reviewer cannot bypass server-owned immutable audit via direct Firestore writes', async () => {
  await seedApprovedMotorized();
  const owner = environment.authenticatedContext('user_a').firestore();
  const ownerDoc = doc(owner, 'identity_verifications', 'user_a');
  await assertSucceeds(updateDoc(ownerDoc, {
    motofreteQualification: motofreteRequest('user_a'),
    updatedAt: serverTimestamp(),
  }));

  const compliance = environment.authenticatedContext('compliance_a').firestore();
  const adminDoc = doc(compliance, 'identity_verifications', 'user_a');
  await assertFails(updateDoc(adminDoc, {
    ...approvedMotofreteFields(),
    'motofreteQualification.courseVerified': false,
  }));
  await assertFails(updateDoc(adminDoc, {
    ...approvedMotofreteFields(),
    'motofreteQualification.validUntil': Timestamp.fromMillis(Date.now() + 366 * 86_400_000),
  }));
  await assertFails(updateDoc(adminDoc, {
    ...approvedMotofreteFields(),
    'motofreteQualification.reviewedBy': 'someone_else',
  }));
  await assertFails(updateDoc(adminDoc, {
    ...approvedMotofreteFields(),
    approvedProfiles: ['bicycle_courier'],
  }));
  await assertFails(updateDoc(adminDoc, approvedMotofreteFields()));
  // Simulate the reviewed Admin SDK transaction; ordinary clients cannot do
  // this independently of a server-created immutable event.
  await environment.withSecurityRulesDisabled(async context => {
    await updateDoc(doc(context.firestore(), 'identity_verifications', 'user_a'), approvedMotofreteFields());
    await setDoc(doc(context.firestore(), 'motofreteReviewEvents', 'evt-approved-a'), {
      schemaVersion: 1,
      userId: 'user_a',
      reviewerId: 'compliance_a',
      decision: 'approved',
      previousStatus: 'submitted',
      nextStatus: 'approved',
      reason: '',
      evidenceFingerprint: 'a'.repeat(64),
      checklist: {},
      validUntil: Timestamp.fromMillis(Date.now() + 30 * 86_400_000),
      createdAt: serverTimestamp(),
    });
  });

  const approved = (await getDoc(ownerDoc)).data();
  if (approved?.motofreteQualification?.status !== 'approved'
    || approved?.motofreteQualification?.reviewedBy !== 'compliance_a'
    || approved.approvedProfiles.join(',') !== 'motorized_courier') {
    throw new Error('Motofrete review failed or modified previous approval');
  }
  await assertFails(updateDoc(ownerDoc, {
    'motofreteQualification.status': 'revoked',
    updatedAt: serverTimestamp(),
  }));
  await assertFails(updateDoc(adminDoc, approvedMotofreteFields())); // no duplicate approval
  await assertFails(updateDoc(adminDoc, {
    'motofreteQualification.status': 'revoked',
    'motofreteQualification.reviewedBy': 'compliance_a',
    'motofreteQualification.reviewedAt': serverTimestamp(),
    'motofreteQualification.reviewReason': 'Documento vencido',
    'motofreteQualification.validUntil': null,
    'motofreteQualification.courseVerified': false,
    'motofreteQualification.minimumAgeAndLicenseTenureVerified': false,
    'motofreteQualification.vehicleRegistrationAndAuthorizationVerified': false,
    'motofreteQualification.safetyEquipmentVerified': false,
    'motofreteQualification.semiannualInspectionVerified': false,
    'motofreteQualification.localRequirementsVerified': false,
    updatedAt: serverTimestamp(),
  }));
  await environment.withSecurityRulesDisabled(async context => {
    await updateDoc(doc(context.firestore(), 'identity_verifications', 'user_a'), {
      'motofreteQualification.status': 'revoked',
      'motofreteQualification.reviewedBy': 'compliance_a',
      'motofreteQualification.reviewedAt': serverTimestamp(),
      'motofreteQualification.reviewReason': 'Documento vencido',
      'motofreteQualification.validUntil': null,
      'motofreteQualification.courseVerified': false,
      'motofreteQualification.minimumAgeAndLicenseTenureVerified': false,
      'motofreteQualification.vehicleRegistrationAndAuthorizationVerified': false,
      'motofreteQualification.safetyEquipmentVerified': false,
      'motofreteQualification.semiannualInspectionVerified': false,
      'motofreteQualification.localRequirementsVerified': false,
      updatedAt: serverTimestamp(),
    });
    await setDoc(doc(context.firestore(), 'motofreteReviewEvents', 'evt-revoked-a'), {
      schemaVersion: 1,
      userId: 'user_a',
      reviewerId: 'compliance_a',
      decision: 'revoked',
      previousStatus: 'approved',
      nextStatus: 'revoked',
      reason: 'Documento vencido',
      evidenceFingerprint: 'a'.repeat(64),
      checklist: {},
      validUntil: null,
      createdAt: serverTimestamp(),
    });
  });
  const revoked = (await getDoc(ownerDoc)).data();
  if (revoked?.motofreteQualification?.status !== 'revoked'
    || revoked.status !== 'approved'
    || revoked.approvedProfiles.join(',') !== 'motorized_courier') {
    throw new Error('Motofrete revocation modified original approval');
  }
  await assertSucceeds(updateDoc(ownerDoc, {
    motofreteQualification: motofreteRequest('user_a'),
    updatedAt: serverTimestamp(),
  }));
});

test('motofrete rejection allows a corrected request, never self-approval or operations approval', async () => {
  await seedApprovedMotorized();
  await environment.withSecurityRulesDisabled(async context => {
    await setDoc(doc(context.firestore(),
      'kyrub_admin','control_plane','admins','operations_a'), {
      uid: 'operations_a',
      email: 'operations@example.com',
      displayName: 'Operations',
      role: 'operations',
      status: 'active',
      createdBy: 'bootstrap_admin',
      createdAt: Timestamp.fromMillis(1_700_000_000_000),
      updatedAt: Timestamp.fromMillis(1_700_000_000_000),
      suspendedAt: '',
      revokedAt: '',
    });
  });
  const owner = environment.authenticatedContext('user_a').firestore();
  const record = doc(owner, 'identity_verifications', 'user_a');
  await assertSucceeds(updateDoc(record, {
    motofreteQualification: motofreteRequest('user_a'),
    updatedAt: serverTimestamp(),
  }));
  const operator = environment.authenticatedContext('operations_a').firestore();
  await assertFails(updateDoc(doc(operator, 'identity_verifications', 'user_a'), {
    ...approvedMotofreteFields(),
    'motofreteQualification.reviewedBy': 'operations_a',
  }));
  const compliance = environment.authenticatedContext('compliance_a').firestore();
  await assertFails(updateDoc(doc(compliance, 'identity_verifications', 'user_a'), {
    'motofreteQualification.status': 'rejected',
    'motofreteQualification.reviewedBy': 'compliance_a',
    'motofreteQualification.reviewedAt': serverTimestamp(),
    'motofreteQualification.reviewReason': 'Inspeção ilegível',
    updatedAt: serverTimestamp(),
  }));
  await environment.withSecurityRulesDisabled(async context => {
    await updateDoc(doc(context.firestore(), 'identity_verifications', 'user_a'), {
      'motofreteQualification.status': 'rejected',
      'motofreteQualification.reviewedBy': 'compliance_a',
      'motofreteQualification.reviewedAt': serverTimestamp(),
      'motofreteQualification.reviewReason': 'Inspeção ilegível',
      updatedAt: serverTimestamp(),
    });
  });
  await assertSucceeds(updateDoc(record, {
    motofreteQualification: {
      ...motofreteRequest('user_a'),
      documents: { ...motofreteDocuments('user_a'),
        inspection: 'identity-verification/user_a/document/inspection-corrected.pdf' },
    },
    updatedAt: serverTimestamp(),
  }));
  await assertFails(updateDoc(record, {
    'motofreteQualification.reviewReason': 'Tudo aprovado',
    updatedAt: serverTimestamp(),
  }));
});

test('private motofrete audit, holds and delivery incidents cannot be forged or altered', async () => {
  await environment.withSecurityRulesDisabled(async context => {
    const privileged = context.firestore();
    await setDoc(doc(privileged, 'motofreteReviewEvents', 'evt-immutable-a'), {
      schemaVersion: 1,
      userId: 'user_a',
      reviewerId: 'compliance_a',
      decision: 'revoked',
      previousStatus: 'approved',
      nextStatus: 'revoked',
      reason: 'Inspeção vencida',
      evidenceFingerprint: 'f'.repeat(64),
      checklist: {},
      validUntil: null,
      createdAt: serverTimestamp(),
    });
    await setDoc(doc(privileged, 'courierComplianceHolds', 'user_a'), {
      userId: 'user_a', active: true, decision: 'revoked', eventId: 'evt-immutable-a',
      reason: 'Atestação específica de motofrete indisponível.', updatedAt: serverTimestamp(),
    });
    await setDoc(doc(privileged, 'deliveryComplianceIncidents', 'delivery-a'), {
      deliveryId: 'delivery-a', courierId: 'user_a', storeId: 'store_a',
      status: 'awaiting_logistics_review', source: 'motofrete_qualification_revoked',
    });
  });
  const owner = environment.authenticatedContext('user_a').firestore();
  const outsider = environment.authenticatedContext('user_b').firestore();
  const compliance = environment.authenticatedContext('compliance_a').firestore();
  const audit = doc(owner, 'motofreteReviewEvents', 'evt-immutable-a');
  const hold = doc(owner, 'courierComplianceHolds', 'user_a');
  const incident = doc(compliance, 'deliveryComplianceIncidents', 'delivery-a');

  await assertSucceeds(getDoc(audit));
  await assertSucceeds(getDoc(hold));
  await assertSucceeds(getDoc(incident));
  await assertSucceeds(getDocs(query(
    collection(compliance, 'motofreteReviewEvents'), where('userId','==','user_a'), limit(50)
  )));
  await assertFails(getDoc(doc(outsider, 'motofreteReviewEvents', 'evt-immutable-a')));
  await assertFails(getDoc(doc(outsider, 'courierComplianceHolds', 'user_a')));
  await assertFails(getDoc(doc(owner, 'deliveryComplianceIncidents', 'delivery-a')));

  for (const client of [owner, compliance]) {
    await assertFails(updateDoc(doc(client, 'motofreteReviewEvents', 'evt-immutable-a'), {
      reason: 'fraud',
    }));
    await assertFails(setDoc(doc(client, 'motofreteReviewEvents', 'evt-fake'), {
      userId: 'user_a',
    }));
    await assertFails(updateDoc(doc(client, 'courierComplianceHolds', 'user_a'), {
      active: false,
    }));
    await assertFails(setDoc(doc(client, 'deliveryComplianceIncidents', 'fake'), {
      courierId: 'user_a',
    }));
  }
});

test('logistics incident disposition events stay server-only and visible to authorized operations', async () => {
  await environment.withSecurityRulesDisabled(async context => {
    await setDoc(doc(context.firestore(), 'deliveryComplianceIncidentEvents', 'evt-reoffer-a'), {
      schemaVersion: 1,
      deliveryId: 'delivery-a',
      incidentId: 'delivery-a',
      courierId: 'user_a',
      storeId: 'store_a',
      operatorId: 'compliance_a',
      decision: 'release_for_new_acceptance',
      deliveryStatusAtDecision: 'accepted',
      reason: 'Retirada não ocorreu e reatribuição autorizada',
      createdAt: serverTimestamp(),
    });
  });
  const courier = environment.authenticatedContext('user_a').firestore();
  const outsider = environment.authenticatedContext('user_b').firestore();
  const compliance = environment.authenticatedContext('compliance_a').firestore();
  const event = doc(compliance, 'deliveryComplianceIncidentEvents', 'evt-reoffer-a');
  await assertSucceeds(getDoc(event));
  await assertSucceeds(getDocs(query(
    collection(compliance, 'deliveryComplianceIncidentEvents'),
    where('deliveryId','==','delivery-a'), limit(30)
  )));
  await assertFails(getDoc(doc(courier, 'deliveryComplianceIncidentEvents', 'evt-reoffer-a')));
  await assertFails(getDoc(doc(outsider, 'deliveryComplianceIncidentEvents', 'evt-reoffer-a')));
  for (const context of [compliance, courier, outsider]) {
    await assertFails(setDoc(doc(context, 'deliveryComplianceIncidentEvents','fake-event'), {
      decision: 'release_for_new_acceptance',
      deliveryId: 'delivery-a',
    }));
    await assertFails(updateDoc(doc(context, 'deliveryComplianceIncidentEvents','evt-reoffer-a'), {
      decision: 'close_after_buyer_confirmation',
    }));
    await assertFails(deleteDoc(doc(context, 'deliveryComplianceIncidentEvents','evt-reoffer-a')));
  }
});

test('supervised custody nominations stay private to participants and audit remains server-only', async () => {
  await environment.withSecurityRulesDisabled(async context => {
    const db = context.firestore();
    await setDoc(doc(db, 'deliveryCustodyTransfers', 'handoff-private-1'), {
      schemaVersion: 1, deliveryId: 'handoff-private-1',
      fromCourierId: 'user_a', toCourierId: 'user_b',
      targetVehicle: 'bicycle', operatorId: 'compliance_a',
      status: 'awaiting_participant_confirmations',
      fromConfirmedAt: null, toConfirmedAt: null,
      createdAt: serverTimestamp(),
    });
    await setDoc(doc(db, 'deliveryCustodyTransferEvents', 'handoff-event-1'), {
      schemaVersion: 1, deliveryId: 'handoff-private-1',
      actorId: 'user_a', actorRole: 'from', action: 'physically_handed_over',
      createdAt: serverTimestamp(),
    });
  });
  const from = environment.authenticatedContext('user_a').firestore();
  const to = environment.authenticatedContext('user_b').firestore();
  const admin = environment.authenticatedContext('compliance_a').firestore();
  const outsider = environment.authenticatedContext('unrelated_user').firestore();
  for (const db of [from,to,admin]) {
    await assertSucceeds(getDoc(doc(db, 'deliveryCustodyTransfers','handoff-private-1')));
  }
  await assertFails(getDoc(doc(outsider, 'deliveryCustodyTransfers','handoff-private-1')));
  await assertSucceeds(getDocs(query(
    collection(from,'deliveryCustodyTransfers'), where('fromCourierId','==','user_a'),limit(25)
  )));
  await assertSucceeds(getDocs(query(
    collection(to,'deliveryCustodyTransfers'), where('toCourierId','==','user_b'),limit(25)
  )));
  await assertSucceeds(getDoc(doc(admin,'deliveryCustodyTransferEvents','handoff-event-1')));
  await assertFails(getDoc(doc(from,'deliveryCustodyTransferEvents','handoff-event-1')));
  for (const db of [from,to,admin,outsider]) {
    await assertFails(updateDoc(doc(db,'deliveryCustodyTransfers','handoff-private-1'), {
      status: 'evidence_recorded_pending_reconciliation',
    }));
    await assertFails(setDoc(doc(db,'deliveryCustodyTransferEvents','forged-handoff-event'), {
      actorId: 'user_a', action: 'physically_handed_over',
    }));
    await assertFails(deleteDoc(doc(db,'deliveryCustodyTransferEvents','handoff-event-1')));
  }
});
