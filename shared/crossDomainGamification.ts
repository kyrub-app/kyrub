export type KyrubChallengeDomain =
  | 'entrepreneurship' | 'study' | 'freelancer' | 'delivery' | 'purchase'
  | 'sale' | 'community' | 'profile' | 'content' | 'referral';

export type SponsoredChallengeFunding = {
  sponsorId: string;
  budgetUnits: number;
  issuanceCap: number;
  redemptionCap: number;
  startsAt: string;
  endsAt: string;
  killSwitch: boolean;
};

export type OpportunityChallengeProposal = {
  opportunityId: string;
  domain: KyrubChallengeDomain;
  title: string;
  rationale: string;
  proposedCriteria: string[];
  proposedRewardUnits: number;
  autonomy: 'proposal_only' | 'human_approved';
  status: 'draft' | 'approved' | 'rejected';
};

export type KyrubiaChallengeView = {
  challengeId: string;
  title: string;
  rules: string[];
  progress: number;
  target: number;
  rewardDescription: string;
  eligible: boolean;
};

export const assertSponsoredChallengeFunding = (funding: SponsoredChallengeFunding) => {
  if (!funding.sponsorId.trim()) throw new Error('SPONSOR_REQUIRED');
  for (const [name, value] of Object.entries({ budgetUnits: funding.budgetUnits, issuanceCap: funding.issuanceCap, redemptionCap: funding.redemptionCap })) {
    if (!Number.isSafeInteger(value) || value < 0) throw new Error(`SPONSORED_${name.toUpperCase()}_INVALID`);
  }
  if (funding.issuanceCap > funding.budgetUnits) throw new Error('SPONSORED_ISSUANCE_EXCEEDS_BUDGET');
  if (Date.parse(funding.startsAt) >= Date.parse(funding.endsAt)) throw new Error('SPONSORED_PERIOD_INVALID');
  return funding;
};

export const assertOpportunityChallengeProposal = (proposal: OpportunityChallengeProposal) => {
  if (!proposal.opportunityId.trim() || !proposal.title.trim() || !proposal.rationale.trim()) throw new Error('OPPORTUNITY_PROPOSAL_INCOMPLETE');
  if (!proposal.proposedCriteria.length) throw new Error('OPPORTUNITY_CRITERIA_REQUIRED');
  if (!Number.isSafeInteger(proposal.proposedRewardUnits) || proposal.proposedRewardUnits < 0) throw new Error('OPPORTUNITY_REWARD_INVALID');
  if (proposal.status === 'approved' && proposal.autonomy !== 'human_approved') throw new Error('OPPORTUNITY_HUMAN_APPROVAL_REQUIRED');
  return proposal;
};

export const canOpportunityPublishChallenge = (proposal: OpportunityChallengeProposal): boolean =>
  proposal.status === 'approved' && proposal.autonomy === 'human_approved';

export const summarizeChallengeForKyrubia = (view: KyrubiaChallengeView) => ({
  challengeId: view.challengeId,
  eligible: view.eligible,
  progress: { current: view.progress, target: view.target },
  reward: view.rewardDescription,
  rules: [...view.rules],
});
