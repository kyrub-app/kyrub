import test from 'node:test';
import assert from 'node:assert/strict';
import {
  FIRST_LOGIN_WELCOME_PITANGAS,
  FIRST_LOGIN_WELCOME_AWARD_ID,
  isWelcomeCampaignEligible,
  planFirstLoginWelcome,
} from '../server/gamification/firstLoginWelcome.js';

test('welcome contract grants exactly 100 Pitangas with stable award identity', () => {
  const plan = planFirstLoginWelcome({
    userId: 'new_user_1',
    authUserCreatedAt: '2026-11-14T12:00:00.000Z',
    verifiedFirstSignInAt: '2026-11-14T12:00:01.000Z',
  });
  assert.equal(FIRST_LOGIN_WELCOME_PITANGAS, 100);
  assert.equal(plan.amount, 100);
  assert.equal(plan.awardId, FIRST_LOGIN_WELCOME_AWARD_ID);
  assert.equal(plan.awardId, 'first_login_welcome_v1');
});

test('welcome campaign is opt-in and only applies to accounts created after cutoff', () => {
  assert.equal(isWelcomeCampaignEligible('2026-11-14T12:00:00Z', undefined), false);
  assert.equal(isWelcomeCampaignEligible('2026-11-13T12:00:00Z', '2026-11-14T00:00:00Z'), false);
  assert.equal(isWelcomeCampaignEligible('2026-11-14T12:00:00Z', '2026-11-14T00:00:00Z'), true);
});

test('welcome plan rejects invalid identity or unverified login chronology', () => {
  assert.throws(() => planFirstLoginWelcome({
    userId: '../other',
    authUserCreatedAt: '2026-11-14T12:00:00Z',
    verifiedFirstSignInAt: '2026-11-14T12:00:01Z',
  }), /WELCOME_USER_INVALID/);
  assert.throws(() => planFirstLoginWelcome({
    userId: 'new_user_1',
    authUserCreatedAt: '2026-11-14T12:00:00Z',
    verifiedFirstSignInAt: '2026-11-13T12:00:00Z',
  }), /WELCOME_FIRST_LOGIN_UNVERIFIED/);
});
