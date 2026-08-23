import assert from 'node:assert/strict';
import test from 'node:test';
import {
  assertOpportunityChallengeProposal,
  assertSponsoredChallengeFunding,
  canOpportunityPublishChallenge,
  summarizeChallengeForKyrubia,
} from '../shared/crossDomainGamification';

test('sponsored challenge cannot issue beyond sponsor budget', () => {
  const base = { sponsorId: 'brand-1', budgetUnits: 1000, issuanceCap: 900, redemptionCap: 800, startsAt: '2026-08-01T00:00:00Z', endsAt: '2026-09-01T00:00:00Z', killSwitch: false };
  assert.equal(assertSponsoredChallengeFunding(base), base);
  assert.throws(() => assertSponsoredChallengeFunding({ ...base, issuanceCap: 1001 }), /SPONSORED_ISSUANCE_EXCEEDS_BUDGET/);
});

test('Opportunity Engine proposes but cannot publish without human approval', () => {
  const draft = { opportunityId: 'opp-1', domain: 'entrepreneurship' as const, title: 'Primeira venda', rationale: 'Ajuda novos lojistas', proposedCriteria: ['first_sale'], proposedRewardUnits: 50, autonomy: 'proposal_only' as const, status: 'draft' as const };
  assert.equal(canOpportunityPublishChallenge(draft), false);
  assert.throws(() => assertOpportunityChallengeProposal({ ...draft, status: 'approved' }), /OPPORTUNITY_HUMAN_APPROVAL_REQUIRED/);
  const approved = { ...draft, autonomy: 'human_approved' as const, status: 'approved' as const };
  assert.equal(canOpportunityPublishChallenge(approved), true);
});

test('Kyrubia receives challenge rules, progress and reward without mutating state', () => {
  const summary = summarizeChallengeForKyrubia({ challengeId: 'c1', title: 'Perfil completo', rules: ['complete_profile'], progress: 2, target: 3, rewardDescription: '100 XP', eligible: true });
  assert.deepEqual(summary.progress, { current: 2, target: 3 });
  assert.equal(summary.reward, '100 XP');
  assert.equal(summary.eligible, true);
});
