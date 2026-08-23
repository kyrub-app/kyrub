export type GamificationFraudSignal =
  | 'multi_account'
  | 'self_referral'
  | 'reward_farming'
  | 'false_evidence'
  | 'duplicate_redemption'
  | 'replay'
  | 'rate_limit_exceeded';

export type GamificationFraudDisposition =
  | 'allow'
  | 'manual_review'
  | 'reject'
  | 'rate_limited';

export interface GamificationFraudAssessment {
  disposition: GamificationFraudDisposition;
  signals: GamificationFraudSignal[];
  rewardIssuanceAllowed: boolean;
  requiresAuditEvent: boolean;
}

const HARD_REJECT = new Set<GamificationFraudSignal>([
  'duplicate_redemption',
  'replay',
  'self_referral',
]);
const MANUAL_REVIEW = new Set<GamificationFraudSignal>([
  'multi_account',
  'reward_farming',
  'false_evidence',
]);

export const assessGamificationFraud = (
  signals: readonly GamificationFraudSignal[]
): GamificationFraudAssessment => {
  const unique = [...new Set(signals)];
  if (unique.includes('rate_limit_exceeded')) {
    return {
      disposition: 'rate_limited',
      signals: unique,
      rewardIssuanceAllowed: false,
      requiresAuditEvent: true,
    };
  }
  if (unique.some(signal => HARD_REJECT.has(signal))) {
    return {
      disposition: 'reject',
      signals: unique,
      rewardIssuanceAllowed: false,
      requiresAuditEvent: true,
    };
  }
  if (unique.some(signal => MANUAL_REVIEW.has(signal))) {
    return {
      disposition: 'manual_review',
      signals: unique,
      rewardIssuanceAllowed: false,
      requiresAuditEvent: true,
    };
  }
  return {
    disposition: 'allow',
    signals: unique,
    rewardIssuanceAllowed: true,
    requiresAuditEvent: false,
  };
};

export const ALL_GAMIFICATION_FRAUD_SIGNALS: readonly GamificationFraudSignal[] = [
  'multi_account',
  'self_referral',
  'reward_farming',
  'false_evidence',
  'duplicate_redemption',
  'replay',
  'rate_limit_exceeded',
];
