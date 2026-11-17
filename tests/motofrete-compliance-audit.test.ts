import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import {
  MOTO_CHECKLIST,
  validateMotofreteReview,
  type MotofreteReviewInput,
} from '../server/identity/motofreteReviewService';

const now = Date.now();
const approved = (): MotofreteReviewInput => ({
  userId: 'user-a',
  reviewerId: 'compliance-a',
  decision: 'approved',
  reason: '',
  validUntilEpochMs: now + 30 * 86_400_000,
  checks: Object.fromEntries(MOTO_CHECKLIST.map(key => [key, true]))
    as MotofreteReviewInput['checks'],
});

test('review policy rejects an absent checklist, self-review, expired and excessively long validity', () => {
  const valid = validateMotofreteReview(approved(), now);
  assert.equal(valid.validUntil?.toMillis(), now + 30 * 86_400_000);
  assert.deepEqual(Object.values(valid.checks), Array(6).fill(true));
  for (const changes of [
    { userId: 'wrong/name' },
    { reviewerId: 'user-a' },
    { reason: 'approve without reviewing' },
    { validUntilEpochMs: now - 1 },
    { validUntilEpochMs: now + 181 * 86_400_000 },
    { validUntilEpochMs: Number.NaN },
    { checks: { ...approved().checks, courseVerified: false } },
  ]) {
    assert.throws(
      () => validateMotofreteReview({ ...approved(), ...changes }, now),
      /COMPLIANCE_REVIEW_INVALID/
    );
  }
});

test('rejection and revocation require a reason, clear approval and cannot extend validity', () => {
  for (const decision of ['rejected', 'revoked'] as const) {
    const request = {
      ...approved(),
      decision,
      checks: Object.fromEntries(MOTO_CHECKLIST.map(key => [key, false]))
        as MotofreteReviewInput['checks'],
      reason: 'Documento com irregularidade',
      validUntilEpochMs: null,
    };
    const result = validateMotofreteReview(request, now);
    assert.equal(result.validUntil, null);
    assert.deepEqual(Object.values(result.checks), Array(6).fill(false));
    assert.throws(() => validateMotofreteReview({ ...request, reason: '' }, now));
    assert.throws(() => validateMotofreteReview({
      ...request, checks: { ...request.checks, localRequirementsVerified: true },
    }, now));
  }
});

test('review and audit are a single privileged transaction, unreachable by direct client edits', () => {
  const service = readFileSync('server/identity/motofreteReviewService.ts', 'utf8');
  const rules = readFileSync('firestore.identity-verification.fragment.rules', 'utf8');
  const router = readFileSync('server/delivery/deliveryOpportunityRouter.ts', 'utf8');
  const control = readFileSync('src/components/admin/AdminIdentityVerificationWorkspace.tsx', 'utf8');
  const pickup = readFileSync('server/delivery/deliveryPickupHandoffService.ts', 'utf8');
  const tracking = readFileSync('src/components/store/CourierLiveTrackingBridge.tsx', 'utf8');

  assert.match(service, /adminDb\.runTransaction/);
  assert.match(service, /transaction\.update\(identityRef/);
  assert.match(service, /transaction\.create\(eventRef/);
  assert.match(service, /transaction\.set\(holdRef/);
  assert.match(service, /reviewer\.status !== 'active'/);
  assert.match(service, /'super_admin', 'compliance'/);
  assert.match(service, /previousStatus !== 'submitted'/);
  assert.match(service, /previousStatus !== 'approved'/);
  assert.match(service, /where\('acceptedBy', '==', input\.userId\)/);
  assert.match(service, /deliveryComplianceIncidents|DELIVERY_INCIDENTS/);
  assert.match(rules, /match \/motofreteReviewEvents\/\{eventId\}/);
  assert.match(rules, /allow create, update, delete: if false/);
  assert.match(rules, /match \/courierComplianceHolds\/\{userId\}/);
  assert.match(rules, /\? false \/\/ Motofrete decisions are server-only/);
  assert.match(router, /router\.post\('\/admin\/motofrete-review'/);
  assert.match(router, /COURIER_COMPLIANCE_HOLD/);
  assert.match(pickup, /transaction\.get\(safetyHoldRef\)/);
  assert.match(pickup, /courierVehicleDocumentEligibility/);
  assert.match(control, /\/api\/delivery-opportunities\/admin\/motofrete-review/);
  assert.match(control, /motofreteReviewEvents/);
  assert.match(tracking, /courierComplianceHolds/);
  assert.match(tracking, /rastreio da entrega pode continuar/);
  assert.doesNotMatch(control, /'motofreteQualification\.reviewedBy': user\.uid/);
});
