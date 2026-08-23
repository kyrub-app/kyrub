import type { GovernanceDocumentType } from './governance.js';

export type ComplianceObservedDomain =
  | 'payments'
  | 'ai'
  | 'gamification'
  | 'store_connections'
  | 'logistics';

export interface ComplianceReviewFinding {
  domain: ComplianceObservedDomain;
  code: string;
  impactedDocuments: GovernanceDocumentType[];
  material: boolean;
}

export interface GovernanceReleaseDecision {
  status: 'clear' | 'human_review_required' | 'blocked';
  requiresHumanLegalReview: boolean;
  blockingCodes: string[];
  findings: ComplianceReviewFinding[];
}

const REQUIRED_DOCUMENTS: Record<ComplianceObservedDomain, GovernanceDocumentType[]> = {
  payments: ['terms', 'privacy', 'payments'],
  ai: ['terms', 'privacy', 'ai', 'lgpd'],
  gamification: ['terms', 'privacy', 'policy'],
  store_connections: ['terms', 'privacy', 'lgpd', 'contract'],
  logistics: ['terms', 'privacy', 'contract'],
};

export const buildComplianceFinding = (
  domain: ComplianceObservedDomain,
  material = true
): ComplianceReviewFinding => ({
  domain,
  code: `MATERIAL_${domain.toUpperCase()}_CHANGE`,
  impactedDocuments: REQUIRED_DOCUMENTS[domain],
  material,
});

export const evaluateGovernanceReleaseGate = (input: {
  findings: readonly ComplianceReviewFinding[];
  humanLegalApprovalRecorded: boolean;
}): GovernanceReleaseDecision => {
  const materialFindings = input.findings.filter(finding => finding.material);
  if (materialFindings.length === 0) {
    return {
      status: 'clear',
      requiresHumanLegalReview: false,
      blockingCodes: [],
      findings: [...input.findings],
    };
  }

  if (!input.humanLegalApprovalRecorded) {
    return {
      status: 'blocked',
      requiresHumanLegalReview: true,
      blockingCodes: materialFindings.map(finding => finding.code),
      findings: [...input.findings],
    };
  }

  return {
    status: 'clear',
    requiresHumanLegalReview: false,
    blockingCodes: [],
    findings: [...input.findings],
  };
};

/**
 * AI/compliance automation may detect, compare and prepare review material.
 * It cannot satisfy the legal approval gate itself.
 */
export const assertHumanLegalAuthority = (input: {
  actorType: 'human' | 'agent';
  approved: boolean;
}): void => {
  if (input.approved && input.actorType !== 'human') {
    throw new Error('HUMAN_LEGAL_APPROVAL_REQUIRED');
  }
};
