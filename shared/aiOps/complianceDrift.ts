export type KyrubComplianceDomain =
  | 'payments'
  | 'logistics'
  | 'gamification'
  | 'external_ai'
  | 'privacy';

export interface KyrubComplianceCapabilityState {
  paymentsRealMoneyEnabled: boolean;
  externalAiConnectionsEnabled: boolean;
  gamificationRewardsEnabled: boolean;
  logisticsFallbackEnabled: boolean;
}

export interface KyrubComplianceDocumentState {
  termsDescribeRealMoney: boolean;
  privacyDescribesExternalAiProviders: boolean;
  termsDescribeGamificationRewards: boolean;
  termsDescribeLogisticsFallback: boolean;
}

export interface KyrubComplianceDriftFinding {
  domain: KyrubComplianceDomain;
  code: string;
  severity: 'info' | 'warning' | 'blocker';
  message: string;
  requiresHumanLegalReview: boolean;
}

export const detectComplianceDrift = (
  capability: KyrubComplianceCapabilityState,
  documents: KyrubComplianceDocumentState
): KyrubComplianceDriftFinding[] => {
  const findings: KyrubComplianceDriftFinding[] = [];
  if (capability.paymentsRealMoneyEnabled && !documents.termsDescribeRealMoney) {
    findings.push({
      domain: 'payments',
      code: 'TERMS_REAL_MONEY_DRIFT',
      severity: 'blocker',
      message: 'Real-money processing is enabled but the Terms state is not aligned.',
      requiresHumanLegalReview: true,
    });
  }
  if (capability.externalAiConnectionsEnabled && !documents.privacyDescribesExternalAiProviders) {
    findings.push({
      domain: 'external_ai',
      code: 'PRIVACY_EXTERNAL_AI_DRIFT',
      severity: 'blocker',
      message: 'External AI connections are enabled but the Privacy state is not aligned.',
      requiresHumanLegalReview: true,
    });
  }
  if (capability.gamificationRewardsEnabled && !documents.termsDescribeGamificationRewards) {
    findings.push({
      domain: 'gamification',
      code: 'TERMS_REWARDS_DRIFT',
      severity: 'warning',
      message: 'Redeemable gamification rewards are enabled but the Terms state is not aligned.',
      requiresHumanLegalReview: true,
    });
  }
  if (capability.logisticsFallbackEnabled && !documents.termsDescribeLogisticsFallback) {
    findings.push({
      domain: 'logistics',
      code: 'TERMS_LOGISTICS_FALLBACK_DRIFT',
      severity: 'warning',
      message: 'Third-party logistics fallback is enabled but the Terms state is not aligned.',
      requiresHumanLegalReview: true,
    });
  }
  return findings;
};
