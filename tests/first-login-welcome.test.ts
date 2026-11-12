import test from 'node:test';
import assert from 'node:assert/strict';
import { planFirstLoginWelcome, FIRST_LOGIN_WELCOME_PITANGAS } from '../server/gamification/firstLoginWelcome.js';

test('first-login welcome is fixed at 1000 Pitangas and idempotent by user', () => {
  const input = {
    userId: 'user_1',
    authUserCreatedAt: '2026-11-12T10:00:00.000Z',
    verifiedFirstSignInAt: '2026-11-12T10:00:01.000Z',
  };
  const a = planFirstLoginWelcome(input);
  assert.equal(a.amount, FIRST_LOGIN_WELCOME_PITANGAS);
  assert.equal(a.awardId, 'first_login_welcome_v1');
  assert.deepEqual(planFirstLoginWelcome(input), a);
});

test('rejects invalid user and sign-in timestamps', () => {
  const valid = { userId: 'user_1', authUserCreatedAt: '2026-11-12T10:00:00Z', verifiedFirstSignInAt: '2026-11-12T10:00:00Z' };
  assert.throws(() => planFirstLoginWelcome({ ...valid, userId: 'invalid/user' }), /WELCOME_USER_INVALID/);
  assert.throws(() => planFirstLoginWelcome({ ...valid, verifiedFirstSignInAt: '2026-11-11T10:00:00Z' }), /WELCOME_FIRST_LOGIN_UNVERIFIED/);
  assert.throws(() => planFirstLoginWelcome({ ...valid, verifiedFirstSignInAt: '2026-11-14T10:00:00Z' }), /WELCOME_FIRST_LOGIN_UNVERIFIED/);
});
