import assert from 'node:assert/strict';
import { test } from 'node:test';
import { planGlobalChallengeDraft, planGlobalChallengePublication } from '../shared/globalChallengeLifecycle.js';
import { listVisibleGlobalChallenges } from '../shared/globalChallengeCatalog.js';
import type { KyrubChallengeDefinition } from '../shared/gamification.js';

const now = '2026-11-05T12:00:00.000Z';
const draft: KyrubChallengeDefinition = {
  id: 'community-first', title: 'First community', description: 'Verified community creation',
  status: 'draft', validationMode: 'deterministic', rewardKCoins: 0, rewardXp: 10,
  maxCompletionsPerUser: 1, sponsorType: 'kyrub',
  startsAt: '2026-11-01T00:00:00.000Z', endsAt: '2026-12-01T00:00:00.000Z',
};

test('only published global challenges enter the public catalog, without mutating the draft', () => {
  const created = planGlobalChallengeDraft(draft, 'admin', now);
  assert.equal(created.audit.action, 'created');
  assert.deepEqual(listVisibleGlobalChallenges([created.challenge], now), []);
  const published = planGlobalChallengePublication(created.challenge, 'admin', now);
  assert.deepEqual(published.audit, { challengeId: draft.id, actorId: 'admin', action: 'published', occurredAt: now });
  assert.deepEqual(listVisibleGlobalChallenges([published.challenge], now), [published.challenge]);
  assert.equal(draft.status, 'draft');
  assert.throws(() => planGlobalChallengePublication(published.challenge, 'admin', now), /NOT_DRAFT/);
});

test('catalog excludes store challenges, scheduled, ended, cancelled and expired entries', () => {
  const published = { ...draft, status: 'published' as const };
  assert.deepEqual(listVisibleGlobalChallenges([
    { ...published, sponsorType: 'store' },
    { ...published, startsAt: '2026-12-01T00:00:00.000Z', endsAt: undefined },
    { ...published, endsAt: now },
    { ...published, status: 'ended' },
    { ...published, status: 'cancelled' },
  ], now), []);
  assert.throws(() => listVisibleGlobalChallenges([published], 'invalid'), /CLOCK_INVALID/);
});

test('publication rejects invalid clocks, invalid periods, ended challenges and non-global sponsors', () => {
  for (const operation of [planGlobalChallengeDraft, planGlobalChallengePublication]) {
    assert.throws(() => operation(draft, 'admin', 'invalid'), /AUDIT_TIME_INVALID/);
    assert.throws(() => operation(draft, '', now), /ADMIN_ACTOR_REQUIRED/);
    assert.throws(() => operation({ ...draft, sponsorType: 'store' }, 'admin', now), /SPONSOR_INVALID/);
  }
  assert.throws(() => planGlobalChallengePublication({ ...draft, endsAt: draft.startsAt }, 'admin', now), /PERIOD_INVALID/);
  assert.throws(() => planGlobalChallengePublication({ ...draft, endsAt: now }, 'admin', now), /ALREADY_ENDED/);
  assert.throws(() => planGlobalChallengePublication({ ...draft, startsAt: 'invalid' }, 'admin', now), /START_INVALID/);
});
