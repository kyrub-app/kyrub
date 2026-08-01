import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import {
  emptyIdentityVerification,
  formatCpf,
  isValidCpf,
  workEligibility,
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
