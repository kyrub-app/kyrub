import assert from 'node:assert/strict';
import test from 'node:test';
import {
  externalInviteClaimEligible,
  generateExternalInviteToken,
  hashExternalInviteToken,
  normalizeExternalInviteEmail,
  verifyExternalInviteToken,
} from '../server/store/externalInvitePrimitives';

test('external invitation tokens are random, hashed and reject altered values', () => {
  const first = generateExternalInviteToken();
  const second = generateExternalInviteToken();
  assert.notEqual(first.token, second.token);
  assert.notEqual(first.token, first.hash);
  assert.equal(first.hash, hashExternalInviteToken(first.token));
  assert.equal(verifyExternalInviteToken(first.token, first.hash), true);
  assert.equal(verifyExternalInviteToken(second.token, first.hash), false);
  assert.equal(verifyExternalInviteToken(first.token, 'invalid'), false);
  assert.equal(verifyExternalInviteToken('', first.hash), false);
});

test('external invitation claim requires a verified matching email and live issued state', () => {
  const valid = {
    invitationEmail: ' Test@Example.com ',
    authenticatedEmail: 'test@example.com',
    emailVerified: true,
    status: 'issued',
    expiresAt: 2000,
    now: 1000,
  };
  assert.equal(externalInviteClaimEligible(valid), true);
  assert.equal(externalInviteClaimEligible({ ...valid, emailVerified: false }), false);
  assert.equal(externalInviteClaimEligible({ ...valid, authenticatedEmail: 'other@example.com' }), false);
  assert.equal(externalInviteClaimEligible({ ...valid, status: 'revoked' }), false);
  assert.equal(externalInviteClaimEligible({ ...valid, expiresAt: 1000 }), false);
  assert.equal(externalInviteClaimEligible({ ...valid, expiresAt: Number.NaN }), false);
  assert.equal(normalizeExternalInviteEmail('invalid'), null);
});
