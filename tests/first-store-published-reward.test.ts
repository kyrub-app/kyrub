import test from 'node:test';
import assert from 'node:assert/strict';
import { FIRST_STORE_PUBLISHED_CHALLENGE_ID, planFirstStorePublishedReward } from '../server/gamification/firstStorePublishedReward.js';
import type { KyrubChallengeDefinition } from '../shared/gamification.js';

const challenge: KyrubChallengeDefinition = {
  id: FIRST_STORE_PUBLISHED_CHALLENGE_ID,
  title: 'Publique sua primeira loja',
  description: 'Publique sua loja no marketplace para receber 2 XP',
  status: 'published',
  validationMode: 'deterministic',
  rewardKCoins: 0,
  rewardXp: 2,
  maxCompletionsPerUser: 1,
  sponsorType: 'kyrub',
};
const event = {
  userId: 'user_1',
  storeId: 'store_1',
  publishedAt: '2026-11-13T12:00:00.000Z',
  isFirstPublication: true,
  isOwnerVerified: true,
  isMarketplaceVisible: true,
};

test('first verified marketplace publication qualifies for exactly 2 XP and zero Pitangas', () => {
  assert.deepEqual(planFirstStorePublishedReward(challenge, event), {
    userId: 'user_1', storeId: 'store_1', challengeId: FIRST_STORE_PUBLISHED_CHALLENGE_ID,
    pitangas: 0, xp: 2, idempotencyKey: 'first_store_user_1',
  });
});

test('login, creation, unpublished stores, and repeat publication cannot qualify', () => {
  for (const change of [
    { isFirstPublication: false },
    { isOwnerVerified: false },
    { isMarketplaceVisible: false },
    { publishedAt: 'invalid' },
    { userId: 'bad/user' },
  ]) {
    assert.throws(() => planFirstStorePublishedReward(challenge, { ...event, ...change }), /UNVERIFIED/);
  }
});

test('draft, Pitangas, wrong challenge and expired campaign are rejected', () => {
  for (const change of [
    { status: 'draft' as const },
    { rewardKCoins: 100 },
    { rewardXp: 3 },
    { id: 'first_store_created' },
  ]) {
    assert.throws(() => planFirstStorePublishedReward({ ...challenge, ...change }, event), /NOT_ELIGIBLE/);
  }
  assert.throws(() => planFirstStorePublishedReward({ ...challenge, endsAt: '2026-11-13T11:00:00.000Z' }, event), /OUTSIDE_WINDOW/);
});

test('idempotency identity stays the same across re-publication and legacy creation challenge', () => {
  assert.equal(planFirstStorePublishedReward(challenge, { ...event, storeId: 'store_2' }).idempotencyKey, 'first_store_user_1');
});
