import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import {
  emptyIdentityVerification,
  formatCpf,
  isValidCpf,
  workEligibility,
  courierVerificationSummary,
  openIdentityVerification,
  IDENTITY_VERIFICATION_OPEN_EVENT,
  mapIdentityVerification,
} from '../src/utils/identityVerification';

test('CPF validation rejects repeated digits and accepts a valid check digit', () => {
  assert.equal(formatCpf('52998224725'), '529.982.247-25');
  assert.equal(isValidCpf('529.982.247-25'), true);
  assert.equal(isValidCpf('111.111.111-11'), false);
  assert.equal(isValidCpf('123'), false);
});

test('work actions remain blocked until the exact profile is approved', () => {
  const record = emptyIdentityVerification('user-1', 'Pessoa Teste');
  assert.equal(workEligibility(record, 'apply_freelance').allowed, false);

  const approved = {
    ...record,
    status: 'approved' as const,
    approvedProfiles: ['freelancer' as const, 'bicycle_courier' as const],
  };
  assert.equal(workEligibility(approved, 'apply_freelance').allowed, true);
  assert.equal(workEligibility(approved, 'accept_delivery').allowed, true);
  assert.equal(workEligibility(approved, 'request_delivery').allowed, false);
});

test('profile verification is separated from public profile editing and gates work flows', () => {
  const app = readFileSync('src/App.tsx', 'utf8');
  const bridge = readFileSync('src/components/ProfileVerificationBridge.tsx', 'utf8');
  const pinRoute = readFileSync('api/security/pin.ts', 'utf8');
  const rules = readFileSync('firestore.identity-verification.fragment.rules', 'utf8');
  const storage = readFileSync('storage.rules', 'utf8');

  assert.match(app, /<ProfileVerificationBridge \/>/);
  assert.match(bridge, /profile-verification-trigger/);
  assert.match(bridge, /Verificação e segurança/);
  assert.match(bridge, /modal-solicitar-freela/);
  assert.match(bridge, /modal-fazer-entregas/);
  assert.match(bridge, /Entrega motorizada exige CNH compatível e EAR/);
  assert.match(bridge, /reconhecimento facial automático/);
  assert.match(pinRoute, /scryptSync/);
  assert.match(pinRoute, /timingSafeEqual/);
  assert.match(pinRoute, /MAX_FAILED_ATTEMPTS = 5/);
  assert.match(rules, /match \/identity_verifications\/\{userId\}/);
  assert.match(rules, /match \/user_security\/\{userId\}/);
  assert.match(storage, /identity-verification\/\{userId\}/);
});


test('courier onboarding uses the same private verification and never treats other approvals as courier approval', () => {
  const base = emptyIdentityVerification('user-2');
  assert.equal(courierVerificationSummary(base).canAccept, false);
  assert.equal(courierVerificationSummary({ ...base, status: 'submitted' }).label, 'Em análise');
  assert.equal(courierVerificationSummary({ ...base, status: 'rejected' }).canAccept, false);
  assert.equal(courierVerificationSummary({
    ...base, status: 'approved', approvedProfiles: ['freelancer'],
  }).canAccept, false);
  assert.equal(courierVerificationSummary({
    ...base, status: 'approved', approvedProfiles: ['bicycle_courier'],
  }).canAccept, true);
  assert.equal(courierVerificationSummary({
    ...base, status: 'approved', approvedProfiles: ['motorized_courier'],
  }).canAccept, true);
});

test('Meu Perfil and Renda open the same canonical verification without a simulated document approval', () => {
  const renda = readFileSync('src/components/tabs/RendaTab.tsx', 'utf8');
  const profile = readFileSync('src/components/modals/UserProfileModal.tsx', 'utf8');
  const verification = readFileSync('src/components/ProfileVerificationBridge.tsx', 'utf8');

  assert.match(renda, /doc\(db, IDENTITY_VERIFICATION_COLLECTION, user\.uid\)/);
  assert.match(renda, /openIdentityVerification\('conta'\)/);
  assert.match(profile, /openIdentityVerification\('documentos'\)/);
  assert.doesNotMatch(profile, /startDocumentSimulation|Preparar documento para análise/);
  assert.match(verification, /IDENTITY_VERIFICATION_OPEN_EVENT, openFromEvent/);
  assert.match(verification, /TABS\.some\(tab => tab\.id === section\)/);
});

test('identity verification opens an explicit section when requested', () => {
  const previousWindow = (globalThis as { window?: unknown }).window;
  let event: Event | null = null;
  (globalThis as { window?: unknown }).window = {
    dispatchEvent: (next: Event) => { event = next; return true; },
  };
  try {
    openIdentityVerification('documentos');
    assert.equal(event?.type, IDENTITY_VERIFICATION_OPEN_EVENT);
    assert.equal((event as CustomEvent<{ section: string }> | null)?.detail?.section, 'documentos');
  } finally {
    (globalThis as { window?: unknown }).window = previousWindow;
  }
});


test('additional courier review remains separate from existing work approval', () => {
  const base = emptyIdentityVerification('user-3');
  const approved = { ...base, status: 'approved' as const, approvedProfiles: ['freelancer' as const] };
  const pending = mapIdentityVerification('user-3', {
    ...approved,
    profileExpansion: {
      profile: 'bicycle_courier', status: 'submitted',
      documentPaths: [], cnhCategory: '', cnhHasEar: false,
      submittedAt: '', reviewedAt: null, reviewedBy: '', reviewReason: '',
    },
  });
  assert.equal(workEligibility(pending, 'apply_freelance').allowed, true);
  assert.equal(workEligibility(pending, 'accept_delivery').allowed, false);
  assert.equal(courierVerificationSummary(pending).label, 'Habilitação em análise');
});

test('motofrete evidence and reviewer state share private canonical identity without default approval', () => {
  const record = mapIdentityVerification('courier_a', {
    status: 'approved',
    approvedProfiles: ['motorized_courier'],
    motofreteQualification: {
      status: 'submitted',
      documents: {
        course: 'identity-verification/courier_a/document/course.pdf',
        vehicle: 'identity-verification/courier_a/document/vehicle.pdf',
        inspection: 'identity-verification/courier_a/document/inspection.pdf',
        equipment: 'identity-verification/courier_a/document/equipment.jpg',
        local: '',
      },
      courseVerified: false,
      minimumAgeAndLicenseTenureVerified: false,
      vehicleRegistrationAndAuthorizationVerified: false,
      safetyEquipmentVerified: false,
      semiannualInspectionVerified: false,
      localRequirementsVerified: false,
      reviewedBy: '',
      reviewReason: '',
      validUntil: null,
    },
  });
  assert.equal(record.motofreteQualification?.status, 'submitted');
  assert.equal(record.motofreteQualification?.documents.course, 'identity-verification/courier_a/document/course.pdf');
  assert.equal(record.motofreteQualification?.courseVerified, false);
  assert.equal(record.motofreteQualification?.reviewedBy, '');
});

test('motofrete UI separates evidence submission and compliance review without automatic qualification', () => {
  const profile = readFileSync('src/components/ProfileVerificationBridge.tsx', 'utf8');
  const admin = readFileSync('src/components/admin/AdminIdentityVerificationWorkspace.tsx', 'utf8');
  const policy = readFileSync('shared/deliveryVehicleCompatibility.ts', 'utf8');
  assert.match(profile, /submitMotofreteQualification/);
  assert.match(profile, /motofreteQualification:\s*\{/);
  assert.match(profile, /courseVerified: false/);
  assert.match(profile, /motofreteQualification\?\.status === 'submitted'/);
  assert.match(admin, /const canReviewMotofrete =/);
  assert.match(admin, /\['super_admin', 'compliance'\]/);
  assert.match(admin, /MOTO_CHECKS/);
  assert.match(admin, /reviewMotofrete\(record, 'revoked'\)/);
  assert.match(admin, /'motofreteQualification\.reviewedBy': user\.uid/);
  assert.match(admin, /'motofreteQualification\.validUntil': validUntil/);
  assert.match(policy, /motofreteQualification/);
  assert.match(policy, /qualification\?\.status === 'approved'/);
  assert.match(policy, /validUntilEpochMs > now/);
});
