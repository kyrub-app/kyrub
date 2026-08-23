import assert from 'node:assert/strict';
import test from 'node:test';
import {
  assertChallengeEngineDefinition,
  challengeCanAutoComplete,
  challengeRequiresHumanDecision,
  type KyrubChallengeEngineDefinition,
} from '../shared/challengeEngine';

const base: KyrubChallengeEngineDefinition = {
  id: 'challenge-1',
  objective: 'Complete an entrepreneurship learning activity',
  description: 'Complete the qualifying event during the challenge period.',
  startsAt: '2026-08-01T00:00:00.000Z',
  endsAt: '2026-09-01T00:00:00.000Z',
  audience: ['entrepreneurs'],
  criteria: ['qualifying_event_completed'],
  validationMode: 'deterministic',
  evidenceKind: 'event',
  rewardKCoins: 50,
  rewardXp: 100,
  budgetUnits: 5000,
  status: 'draft',
};

test('challenge engine requires objective, audience, criteria, period, evidence, reward and budget contract', () => {
  assert.equal(assertChallengeEngineDefinition(base), base);
  assert.throws(() => assertChallengeEngineDefinition({ ...base, audience: [] }), /CHALLENGE_AUDIENCE_REQUIRED/);
  assert.throws(() => assertChallengeEngineDefinition({ ...base, criteria: [] }), /CHALLENGE_CRITERIA_REQUIRED/);
  assert.throws(() => assertChallengeEngineDefinition({ ...base, endsAt: base.startsAt }), /CHALLENGE_PERIOD_INVALID/);
});

test('automatic validation only accepts authoritative event evidence', () => {
  assert.throws(
    () => assertChallengeEngineDefinition({ ...base, evidenceKind: 'feed_post' }),
    /CHALLENGE_AUTOMATIC_REQUIRES_EVENT_EVIDENCE/
  );
  assert.equal(challengeCanAutoComplete('deterministic'), true);
  assert.equal(challengeCanAutoComplete('external_integration'), true);
  assert.equal(challengeCanAutoComplete('feed_post'), false);
});

test('feed, community and Kyrubia-assisted paths still require a decision', () => {
  assert.equal(challengeRequiresHumanDecision('feed_post'), true);
  assert.equal(challengeRequiresHumanDecision('community_review'), true);
  assert.equal(challengeRequiresHumanDecision('kyrubia_assisted'), true);
  assert.equal(challengeRequiresHumanDecision('deterministic'), false);
});
