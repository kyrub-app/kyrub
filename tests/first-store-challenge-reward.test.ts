import test from 'node:test';
import assert from 'node:assert/strict';
import { FIRST_STORE_CHALLENGE_ID, planFirstStoreChallengeReward } from '../server/gamification/firstStoreChallengeReward.js';
import type { KyrubChallengeDefinition } from '../shared/gamification.js';

const challenge: KyrubChallengeDefinition = {
  id: FIRST_STORE_CHALLENGE_ID,
  title: 'Minha primeira loja no Kyrub',
  description: 'Crie sua primeira loja',
  status: 'published',
  validationMode: 'deterministic',
  rewardKCoins: 0,
  rewardXp: 2,
  maxCompletionsPerUser: 1,
  sponsorType: 'kyrub',
};
const event = { userId: 'user_1', storeId: 'store_1', createdAt: '2026-11-12T12:00:00.000Z', isFirstStore: true };

test('plans XP-only first-store reward with stable user-level idempotency', () => {
  const result = planFirstStoreChallengeReward(challenge, event);
  assert.equal(result.pitangas, 0);
  assert.equal(result.xp, 2);
  assert.equal(result.idempotencyKey, 'first_store_user_1');
  assert.deepEqual(planFirstStoreChallengeReward(challenge, { ...event, storeId: 'store_2' }).idempotencyKey, result.idempotencyKey);
});

test('rejects unverified or subsequent store creation', () => {
  assert.throws(() => planFirstStoreChallengeReward(challenge, { ...event, isFirstStore: false }), /FIRST_STORE_EVENT_UNVERIFIED/);
  assert.throws(() => planFirstStoreChallengeReward(challenge, { ...event, userId: 'bad/user' }), /FIRST_STORE_EVENT_UNVERIFIED/);
});

test('rejects non-published, non-deterministic and expired challenges', () => {
  assert.throws(() => planFirstStoreChallengeReward({ ...challenge, status: 'draft' }, event), /NOT_ELIGIBLE/);
  assert.throws(() => planFirstStoreChallengeReward({ ...challenge, validationMode: 'manual_review' }, event), /NOT_ELIGIBLE/);
  assert.throws(() => planFirstStoreChallengeReward({ ...challenge, endsAt: '2026-11-11T00:00:00.000Z' }, event), /OUTSIDE_WINDOW/);
});

test('rejects Pitangas on first-store challenge to avoid double welcome grant', () => {
  assert.throws(() => planFirstStoreChallengeReward({ ...challenge, rewardKCoins: 1000 }, event), /NOT_ELIGIBLE/);
});
