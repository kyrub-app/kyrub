import type {
  KyrubChallengeClaim,
  KyrubRewardLedgerEntry,
} from './gamification.js';

export interface KyrubEconomicGovernanceSnapshot {
  issuedKCoins: number;
  circulatingKCoins: number;
  redeemedKCoins: number;
  expiredKCoins: number;
}

export interface KyrubIssuanceBudget {
  issuanceCapKCoins: number;
  issuedKCoins: number;
  killSwitch: boolean;
}

const sumByType = (entries: readonly KyrubRewardLedgerEntry[], type: KyrubRewardLedgerEntry['type']): number =>
  entries
    .filter(entry => entry.type === type)
    .reduce((sum, entry) => sum + Math.abs(entry.deltaKCoins), 0);

export const buildKyrubEconomicGovernanceSnapshot = (
  entries: readonly KyrubRewardLedgerEntry[]
): KyrubEconomicGovernanceSnapshot => {
  const issuedKCoins = sumByType(entries, 'earn');
  const redeemedKCoins = sumByType(entries, 'redeem');
  const expiredKCoins = sumByType(entries, 'expire');
  const circulatingKCoins = entries.reduce((sum, entry) => sum + entry.deltaKCoins, 0);
  if (circulatingKCoins < 0) throw new Error('GAMIFICATION_NEGATIVE_CIRCULATION');
  return { issuedKCoins, circulatingKCoins, redeemedKCoins, expiredKCoins };
};

export const assertKyrubIssuanceAllowed = (input: {
  budget: KyrubIssuanceBudget;
  requestedKCoins: number;
}): void => {
  if (input.budget.killSwitch) throw new Error('GAMIFICATION_ISSUANCE_KILL_SWITCH');
  if (!Number.isSafeInteger(input.requestedKCoins) || input.requestedKCoins <= 0) {
    throw new Error('GAMIFICATION_ISSUANCE_INVALID');
  }
  if (input.budget.issuedKCoins + input.requestedKCoins > input.budget.issuanceCapKCoins) {
    throw new Error('GAMIFICATION_ISSUANCE_CAP_EXCEEDED');
  }
};

export interface KyrubFeedEvidenceSubmission {
  claimId: string;
  postId: string;
  submittedByUserId: string;
  submittedAt: string;
}

export const attachFeedEvidence = (input: {
  claim: KyrubChallengeClaim;
  evidence: KyrubFeedEvidenceSubmission;
}): KyrubChallengeClaim => {
  if (input.claim.userId !== input.evidence.submittedByUserId) {
    throw new Error('FEED_EVIDENCE_USER_MISMATCH');
  }
  if (input.claim.status === 'approved' || input.claim.status === 'rewarded') {
    throw new Error('FEED_EVIDENCE_CLAIM_ALREADY_DECIDED');
  }
  const ref = `feed:${input.evidence.postId.trim()}`;
  if (ref === 'feed:') throw new Error('FEED_EVIDENCE_POST_REQUIRED');
  return {
    ...input.claim,
    status: 'submitted',
    evidenceRefs: [...new Set([...input.claim.evidenceRefs, ref])],
    submittedAt: input.evidence.submittedAt,
  };
};
