import type { CommerceChannel, FiscalItemPreparation } from './channelAvailabilityFiscalFoundation';
import type {
  FiscalHomologationDocumentFamily,
  FiscalHomologationOperationScope,
  FiscalHomologationOperationalTrigger,
} from './fiscalHomologationPolicy';
import type {
  FiscalCanonicalPaymentEvidence,
  FiscalHomologationIssuerIdentityEvidence,
} from './fiscalHomologationPreflightSimulation';
import type { FiscalExecutableDocumentStatus } from './fiscalExecutableDocument';

export type FiscalHomologationAttemptState =
  | 'prepared'
  | 'processing'
  | 'authorized'
  | 'rejected'
  | 'technical_failure'
  | 'reconciliation_required'
  | 'manual_review_required';

export type FiscalHomologationAttemptAuthorizationMode =
  | 'canonical_store_owner_fallback';

export interface FiscalHomologationAttemptActorEvidence {
  userId: string;
  resolvedRole: 'owner';
  requiredPermission: 'fiscal.homologation.emit';
  authorizationMode: FiscalHomologationAttemptAuthorizationMode;
}

export interface FiscalHomologationAttemptPolicyEvidence {
  policyId: string;
  version: number;
  policyReference: string;
  effectiveFrom: string;
  operationScope: FiscalHomologationOperationScope;
  documentFamily: FiscalHomologationDocumentFamily;
  operationalTrigger: FiscalHomologationOperationalTrigger;
  environment: 'sandbox';
}

export interface FiscalHomologationAttemptConsumerEvidence {
  status: 'identified' | 'not_provided';
  identifierKind: 'cpf' | 'cnpj' | null;
  maskedTaxIdentifier: string | null;
}

export interface FiscalHomologationAttemptTriggerEvidence {
  trigger: FiscalHomologationOperationalTrigger;
  satisfied: true;
  authority: 'canonical_payment_projection';
  payment: FiscalCanonicalPaymentEvidence | null;
}

export interface FiscalHomologationAttempt {
  schemaVersion: 1;
  attemptId: string;
  evidenceFingerprint: string;
  canonicalStoreId: string;
  orderId: string;
  sourceChannel: CommerceChannel;
  environment: 'sandbox';
  policy: FiscalHomologationAttemptPolicyEvidence;
  issuerIdentity: FiscalHomologationIssuerIdentityEvidence;
  consumerIdentity: FiscalHomologationAttemptConsumerEvidence;
  productPreparation: FiscalItemPreparation[];
  triggerEvidence: FiscalHomologationAttemptTriggerEvidence;
  actor: FiscalHomologationAttemptActorEvidence;
  state: FiscalHomologationAttemptState;
  fiscalDocumentSnapshotId: string | null;
  fiscalDocumentStatus: FiscalExecutableDocumentStatus | null;
  providerAdapterId: string | null;
  providerAdapterVersion: string | null;
  externalRequestId: string | null;
  providerPayloadFingerprint: string | null;
  providerStatus: string | null;
  providerCode: string | null;
  providerMessage: string | null;
  authorizationProtocol: string | null;
  accessKey: string | null;
  documentNumber: string | null;
  submittedAt: string | null;
  lastCheckedAt: string | null;
  createdAt: string;
  updatedAt: string;
  authority: 'kyrub_fiscal_homologation_attempt_ledger';
}

const ALLOWED_TRANSITIONS: Record<
  FiscalHomologationAttemptState,
  readonly FiscalHomologationAttemptState[]
> = {
  prepared: ['processing', 'manual_review_required'],
  processing: [
    'authorized',
    'rejected',
    'technical_failure',
    'reconciliation_required',
    'manual_review_required',
  ],
  authorized: [],
  rejected: [],
  technical_failure: ['processing', 'manual_review_required'],
  reconciliation_required: [
    'authorized',
    'rejected',
    'technical_failure',
    'manual_review_required',
  ],
  manual_review_required: [
    'processing',
    'reconciliation_required',
    'technical_failure',
  ],
};

export const canTransitionFiscalHomologationAttemptState = (
  from: FiscalHomologationAttemptState,
  to: FiscalHomologationAttemptState
): boolean => ALLOWED_TRANSITIONS[from].includes(to);

export const assertFiscalHomologationAttemptStateTransition = (
  from: FiscalHomologationAttemptState,
  to: FiscalHomologationAttemptState
): void => {
  if (!canTransitionFiscalHomologationAttemptState(from, to)) {
    throw new Error(`FISCAL_ATTEMPT_STATE_TRANSITION_INVALID:${from}->${to}`);
  }
};
