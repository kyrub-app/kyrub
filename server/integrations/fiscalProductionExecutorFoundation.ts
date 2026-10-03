import type { FiscalProductionAuthorization } from './fiscalProductionAuthorization.js';
import {
  assertFiscalProductionExecutionPrerequisites,
  type FiscalProductionCredentialEvidence,
  type FiscalProductionProviderConfiguration,
} from './fiscalProductionExecutionPrerequisites.js';

export type FiscalProductionExecutorState =
  | 'prepared'
  | 'processing'
  | 'authorized'
  | 'rejected'
  | 'reconciliation_required';

export interface FiscalProductionExecutionClaim {
  schemaVersion: 1;
  canonicalStoreId: string;
  attemptId: string;
  state: 'processing';
  adapterId: string;
  adapterVersion: string;
  credentialVersion: string;
  externalRequestId: string;
  payloadFingerprint: string;
  claimedAt: string;
  authority: 'server_fiscal_production_executor_foundation';
}

const ATTEMPT_ID_PATTERN = /^fiscal-attempt-[a-f0-9]{48}$/;
const SHA256_PATTERN = /^[a-f0-9]{64}$/;

const clean = (value: unknown, maxLength = 240): string =>
  typeof value === 'string' ? value.trim().slice(0, maxLength) : '';

/**
 * Non-routable production executor foundation.
 *
 * This function deliberately has no provider transport and no Firestore write.
 * It proves that a future transactional claim may only be constructed after
 * authorization, production configuration and credential evidence match.
 */
export const prepareFiscalProductionExecutionClaim = (input: {
  canonicalStoreId: string;
  attemptId: string;
  currentState: FiscalProductionExecutorState;
  authorization: FiscalProductionAuthorization | null | undefined;
  configuration: FiscalProductionProviderConfiguration | null | undefined;
  credential: FiscalProductionCredentialEvidence | null | undefined;
  externalRequestId: string;
  payloadFingerprint: string;
  claimedAt: string;
}): FiscalProductionExecutionClaim => {
  const canonicalStoreId = clean(input.canonicalStoreId, 160);
  const attemptId = clean(input.attemptId, 160);
  const externalRequestId = clean(input.externalRequestId, 160);
  const payloadFingerprint = clean(input.payloadFingerprint, 80);
  const claimedAt = clean(input.claimedAt, 80);

  if (!ATTEMPT_ID_PATTERN.test(attemptId)) {
    throw new Error('FISCAL_PRODUCTION_ATTEMPT_ID_INVALID');
  }
  if (input.currentState !== 'prepared') {
    throw new Error('FISCAL_PRODUCTION_ATTEMPT_NOT_PREPARED');
  }
  if (!externalRequestId || !SHA256_PATTERN.test(payloadFingerprint) || !claimedAt) {
    throw new Error('FISCAL_PRODUCTION_PREPARED_SUBMISSION_INVALID');
  }

  const prerequisites = assertFiscalProductionExecutionPrerequisites({
    canonicalStoreId,
    authorization: input.authorization,
    configuration: input.configuration,
    credential: input.credential,
  });

  return {
    schemaVersion: 1,
    canonicalStoreId,
    attemptId,
    state: 'processing',
    adapterId: prerequisites.configuration.adapterId,
    adapterVersion: prerequisites.configuration.adapterVersion,
    credentialVersion: prerequisites.credential.version,
    externalRequestId,
    payloadFingerprint,
    claimedAt,
    authority: 'server_fiscal_production_executor_foundation',
  };
};

/**
 * Provider exceptions and unknown submission outcomes are never authorization.
 */
export const fiscalProductionUnknownOutcomeState = (
  currentState: FiscalProductionExecutorState
): 'reconciliation_required' => {
  if (currentState !== 'processing' && currentState !== 'reconciliation_required') {
    throw new Error('FISCAL_PRODUCTION_RECONCILIATION_STATE_INVALID');
  }
  return 'reconciliation_required';
};
