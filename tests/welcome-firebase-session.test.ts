import test from 'node:test';
import assert from 'node:assert/strict';
import { assertGoogleSignInProviderClaim, verifyWelcomeFirebaseSession } from '../server/gamification/welcomeFirebaseSession.js';

test('welcome session rejects unsigned and malformed browser-provided token', async () => {
  for (const token of ['', 'not-a-jwt', 'eyJhbGciOiJub25lIn0.eyJzdWIiOiJ2aWN0aW0iLCJhdXRoX3RpbWUiOjE3OTQ2NTc2MDB9.signature']) {
    await assert.rejects(verifyWelcomeFirebaseSession(token, 'kyrub-security-test'));
  }
});

test('welcome session cannot use a standalone client timestamp in place of a Firebase ID token', async () => {
  await assert.rejects(verifyWelcomeFirebaseSession('1794657600', 'kyrub-security-test'));
});


test('Google sign-in claim rejects password, anonymous, custom and absent providers', () => {
  assert.doesNotThrow(() => assertGoogleSignInProviderClaim({ sign_in_provider: 'google.com' }));
  for (const claim of [undefined, null, {}, 'google.com',
    { sign_in_provider: 'password' }, { sign_in_provider: 'anonymous' },
    { sign_in_provider: 'custom' }, { sign_in_provider: 'google.com ' }]) {
    assert.throws(() => assertGoogleSignInProviderClaim(claim), /WELCOME_GOOGLE_SIGN_IN_REQUIRED/);
  }
});
