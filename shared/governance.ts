export type GovernanceDocumentType =
  | 'terms'
  | 'privacy'
  | 'payments'
  | 'ai'
  | 'lgpd'
  | 'contract'
  | 'policy';

export type GovernanceDocumentStatus =
  | 'draft'
  | 'legal_review'
  | 'approved'
  | 'published'
  | 'superseded';

export interface GovernanceDocument {
  id: string;
  type: GovernanceDocumentType;
  version: string;
  hash: string;
  status: GovernanceDocumentStatus;
  ownerUserId: string;
  createdAt: string;
  approvedAt?: string;
  publishedAt?: string;
  supersededAt?: string;
}

export interface VersionedConsent {
  id: string;
  userId: string;
  documentId: string;
  documentType: GovernanceDocumentType;
  documentVersion: string;
  documentHash: string;
  acceptedAt: string;
  correlationId: string;
}

const TRANSITIONS: Record<GovernanceDocumentStatus, readonly GovernanceDocumentStatus[]> = {
  draft: ['legal_review'],
  legal_review: ['draft', 'approved'],
  approved: ['published'],
  published: ['superseded'],
  superseded: [],
};

const required = (value: string, label: string): string => {
  const normalized = value.trim();
  if (!normalized) throw new Error(`${label} is required.`);
  return normalized;
};

export const assertGovernanceDocument = (document: GovernanceDocument): GovernanceDocument => {
  required(document.id, 'governance.id');
  required(document.version, 'governance.version');
  required(document.hash, 'governance.hash');
  required(document.ownerUserId, 'governance.ownerUserId');
  required(document.createdAt, 'governance.createdAt');
  if (document.status === 'approved' && !document.approvedAt) {
    throw new Error('GOVERNANCE_APPROVED_AT_REQUIRED');
  }
  if (document.status === 'published' && (!document.approvedAt || !document.publishedAt)) {
    throw new Error('GOVERNANCE_PUBLICATION_TIMESTAMPS_REQUIRED');
  }
  return document;
};

export const assertGovernanceTransition = (
  from: GovernanceDocumentStatus,
  to: GovernanceDocumentStatus
): void => {
  if (!TRANSITIONS[from].includes(to)) {
    throw new Error(`GOVERNANCE_TRANSITION_FORBIDDEN:${from}->${to}`);
  }
};

export const assertVersionedConsentMatchesDocument = (
  consent: VersionedConsent,
  document: GovernanceDocument
): VersionedConsent => {
  if (document.status !== 'published') throw new Error('CONSENT_DOCUMENT_NOT_PUBLISHED');
  if (
    consent.documentId !== document.id ||
    consent.documentType !== document.type ||
    consent.documentVersion !== document.version ||
    consent.documentHash !== document.hash
  ) {
    throw new Error('CONSENT_DOCUMENT_VERSION_MISMATCH');
  }
  required(consent.userId, 'consent.userId');
  required(consent.acceptedAt, 'consent.acceptedAt');
  required(consent.correlationId, 'consent.correlationId');
  return consent;
};
