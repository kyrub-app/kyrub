import type { GovernanceDocumentType } from './governance.js';

export type MaterialProductChangeDomain =
  | 'payments'
  | 'ai'
  | 'gamification'
  | 'store_connections'
  | 'logistics'
  | 'identity'
  | 'data_retention';

export interface LegalDriftAssessment {
  material: boolean;
  impactedDocuments: GovernanceDocumentType[];
  requiresHumanReview: boolean;
  message?: string;
}

const IMPACTS: Record<MaterialProductChangeDomain, readonly GovernanceDocumentType[]> = {
  payments: ['terms', 'privacy', 'payments'],
  ai: ['terms', 'privacy', 'ai', 'lgpd'],
  gamification: ['terms', 'privacy', 'policy'],
  store_connections: ['terms', 'privacy', 'lgpd', 'contract'],
  logistics: ['terms', 'privacy', 'contract'],
  identity: ['privacy', 'lgpd', 'terms'],
  data_retention: ['privacy', 'lgpd', 'policy'],
};

export const detectLegalDrift = (input: {
  domains: readonly MaterialProductChangeDomain[];
  material: boolean;
}): LegalDriftAssessment => {
  if (!input.material || input.domains.length === 0) {
    return { material: false, impactedDocuments: [], requiresHumanReview: false };
  }
  const impactedDocuments = [...new Set(input.domains.flatMap(domain => IMPACTS[domain]))];
  return {
    material: true,
    impactedDocuments,
    requiresHumanReview: true,
    message: 'Esta alteração pode tornar documentos de governança desatualizados. Revisão humana necessária antes da publicação quando aplicável.',
  };
};
