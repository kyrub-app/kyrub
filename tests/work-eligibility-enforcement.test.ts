import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

test('delivery API requires approved requester or courier profiles', () => {
  const server = readFileSync('server.ts', 'utf8');
  const middleware = readFileSync(
    'server/identity/workEligibilityMiddleware.ts',
    'utf8'
  );

  assert.match(server, /enforceDeliveryWorkEligibility/);
  assert.match(
    server,
    /"\/api\/delivery-opportunities",\s*integrationRateLimiter,\s*enforceDeliveryWorkEligibility/
  );
  assert.match(middleware, /profile === 'requester'/);
  assert.match(middleware, /profile === 'courier'/);
  assert.match(middleware, /identity_verifications\/\$\{uid\}/);
  assert.match(middleware, /data\?\.status !== 'approved'/);
  assert.match(middleware, /IDENTITY_VERIFICATION_REQUIRED/);
});

test('composed Firestore rules require verified profiles for freelance activity', () => {
  const composer = readFileSync('scripts/compose-firestore-rules.mjs', 'utf8');
  const transform = readFileSync('scripts/firestore-rule-composition.mjs', 'utf8');
  const helpers = readFileSync('firestore.identity-eligibility.fragment.rules', 'utf8');

  assert.match(composer, /hardenKyrubFreelanceRules/);
  assert.match(composer, /firestore\.identity-eligibility\.fragment\.rules/);
  assert.match(transform, /hasApprovedIdentityProfile\('requester'\)/);
  assert.match(transform, /hasApprovedIdentityProfile\('freelancer'\)/);
  assert.match(helpers, /hasApprovedCourierProfile/);
});
