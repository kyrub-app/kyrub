import assert from 'node:assert/strict';
import { test } from 'node:test';
import { screenAge, evaluateAgeAccess, evaluateCapabilityAgeAccess, type AgeStatus, type AgeCapability } from '../shared/ageEligibility.js';

const screen = (birthDate: string, today = '2026-11-25', declaredAdult = true) =>
  screenAge({ birthDate, today, declaredAdult });

test('civil birthday boundary and declaration do not imply verification', () => {
  assert.deepEqual(screen('2008-11-25'), { status: 'declared_adult' });
  assert.deepEqual(screen('2008-11-26'), { status: 'declared_underage' });
  assert.deepEqual(screen('2008-11-24', '2026-11-25', false), {
    status: 'pending', reason: 'declaration_required',
  });
  assert.deepEqual(screen('2008-11-26', '2026-11-25', false), { status: 'declared_underage' });
});

test('reject invalid and future civil dates', () => {
  for (const birth of ['2008-02-30', '2007-02-29', '2008-2-29', '0000-01-01', '']) {
    assert.deepEqual(screen(birth), { status: 'pending', reason: 'invalid_date' });
  }
  assert.deepEqual(screen('2026-11-26'), { status: 'pending', reason: 'future_birth_date' });
  assert.deepEqual(screen('2008-11-25', '2026-11-31'), { status: 'pending', reason: 'invalid_date' });
  assert.deepEqual(screen('9999-01-01', '9999-01-01'), { status: 'declared_underage' });
});

test('conservative leap day boundary', () => {
  assert.deepEqual(screen('2008-02-29', '2026-02-28'), { status: 'declared_underage' });
  assert.deepEqual(screen('2008-02-29', '2026-03-01'), { status: 'declared_adult' });
});

test('restricted scope fails closed without reviewed release policy', () => {
  const statuses: AgeStatus[] = ['pending', 'declared_adult', 'declared_underage', 'verified_adult',
    'verified_underage', 'inconclusive', 'suspended'];
  for (const status of statuses) {
    const input = { scope: 'restricted' as const, status, authenticated: true };
    assert.equal(evaluateAgeAccess(input), false);
    assert.equal(evaluateAgeAccess({ ...input, releasePolicy: 'blocked' }), false);
    assert.equal(evaluateAgeAccess({ ...input, releasePolicy: 'reliable_required' }), false);
    assert.equal(evaluateAgeAccess({ ...input, releasePolicy: 'preliminary_approved' }),
      false);
    assert.equal(evaluateAgeAccess({ ...input, authenticated: false, releasePolicy: 'reliable_required' }), false);
  }
});

test('appropriate public pages and support remain accessible; onboarding requires auth', () => {
  for (const scope of ['public_appropriate', 'support'] as const) {
    assert.equal(evaluateAgeAccess({ scope, status: 'verified_underage', authenticated: false }), true);
  }
  assert.equal(evaluateAgeAccess({ scope: 'onboarding', status: 'pending', authenticated: false }), false);
  assert.equal(evaluateAgeAccess({ scope: 'onboarding', status: 'pending', authenticated: true }), true);
});

test('inconclusive accounts receive only reviewed personal capabilities', () => {
  const allowed: AgeCapability[] = ['private_notes','private_tasks','appropriate_courses','private_tag_management'];
  const denied: AgeCapability[] = ['tag_publication','social_publication','social_comment','sowing','connections','messages','communities','tribes','store_erp','freelance','delivery','financial_operations','rewards'];
  for (const capability of [...allowed, ...denied]) {
    const input = { capability, status: 'inconclusive' as const, authenticated: true };
    assert.equal(evaluateCapabilityAgeAccess(input), false);
    assert.equal(evaluateCapabilityAgeAccess({ ...input, policy: 'reviewed_personal_only' }), allowed.includes(capability));
    assert.equal(evaluateCapabilityAgeAccess({ ...input, policy: 'verified_adult_only' }), false);
    assert.equal(evaluateCapabilityAgeAccess({ ...input, status: 'verified_adult', policy: 'verified_adult_only' }), true);
    for (const status of ['pending','declared_adult','declared_underage','verified_underage','suspended'] as const) {
      assert.equal(evaluateCapabilityAgeAccess({ ...input, status, policy: 'reviewed_personal_only' }), false);
    }
    assert.equal(evaluateCapabilityAgeAccess({ ...input, authenticated: false, policy: 'reviewed_personal_only' }), false);
  }
  assert.equal(evaluateCapabilityAgeAccess({ capability: 'unknown' as AgeCapability, status: 'verified_adult', authenticated: true, policy: 'verified_adult_only' }), false);
});

test('stored evidence is bound to authenticated identity and never grants from declaration', async () => {
  const { evaluateStoredCapabilityAgeAccess } = await import('../shared/ageEligibility.js');
  const base = { actorUid: 'owner', capability: 'account_ingress' as const, policy: 'verified_adult_only' as const };
  assert.equal(evaluateStoredCapabilityAgeAccess({ ...base, record: { uid:'owner', status:'verified_adult' } }), true);
  for (const record of [undefined, {uid:'other',status:'verified_adult'}, {uid:'owner',status:'declared_adult'}, {uid:'owner',status:'suspended'}]) {
    assert.equal(evaluateStoredCapabilityAgeAccess({ ...base, record }), false);
  }
});
