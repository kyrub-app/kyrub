import test from 'node:test';
import assert from 'node:assert/strict';
import { verifyWelcomeInitialSession } from '../server/gamification/welcomeInitialSession.js';

const base = {
  uid: 'new-user', tokenUid: 'new-user',
  authTimeSeconds: Date.parse('2026-11-12T12:00:30Z') / 1000,
  firebaseCreatedAt: '2026-11-12T12:00:00Z',
  campaignEffectiveAt: '2026-11-12T00:00:00Z',
};

test('accepts signed initial-session timestamp for new account', () => {
  assert.deepEqual(verifyWelcomeInitialSession(base), { occurredAt: '2026-11-12T12:00:30.000Z' });
});

test('rejects mismatched Firebase UID, invalid auth time and historical accounts', () => {
  for (const change of [
    { tokenUid: 'someone-else' },
    { authTimeSeconds: NaN },
    { firebaseCreatedAt: '2026-11-11T12:00:00Z' },
    { authTimeSeconds: Date.parse('2026-11-14T12:00:30Z') / 1000 },
    { authTimeSeconds: Date.parse('2026-11-12T11:57:00Z') / 1000 },
    { authTimeSeconds: Date.parse('2026-11-12T12:00:30Z') / 1000, campaignEffectiveAt: '2026-11-12T12:02:00Z' },
  ]) {
    assert.throws(() => verifyWelcomeInitialSession({ ...base, ...change }), /WELCOME_INITIAL_SESSION_/);
  }
});
