import test from 'node:test';
import assert from 'node:assert/strict';
import { verifyWelcomeInitialSession } from '../server/gamification/welcomeInitialSession.js';

const base = {
  uid: 'new_user_1',
  tokenUid: 'new_user_1',
  authTimeSeconds: Date.parse('2026-11-14T12:00:30Z') / 1000,
  firebaseCreatedAt: '2026-11-14T12:00:00Z',
  campaignEffectiveAt: '2026-11-14T00:00:00Z',
};

test('accepts Firebase-signed initial session chronology', () => {
  assert.equal(verifyWelcomeInitialSession(base).occurredAt, '2026-11-14T12:00:30.000Z');
});

test('rejects mismatched UID', () => {
  assert.throws(() => verifyWelcomeInitialSession({ ...base, tokenUid: 'other_user' }), /WELCOME_INITIAL_SESSION_UNVERIFIED/);
});

test('rejects pre-campaign accounts', () => {
  assert.throws(() => verifyWelcomeInitialSession({
    ...base, firebaseCreatedAt: '2026-11-13T12:00:00Z',
  }), /WELCOME_INITIAL_SESSION_INELIGIBLE/);
});

test('rejects late sessions rather than treating every Google login as first login', () => {
  assert.throws(() => verifyWelcomeInitialSession({
    ...base, authTimeSeconds: Date.parse('2026-11-16T12:00:00Z') / 1000,
  }), /WELCOME_INITIAL_SESSION_INELIGIBLE/);
});
