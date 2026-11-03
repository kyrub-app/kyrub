import type { PrepaidRenewalPixAttempt } from './prepaidRenewalPixAttempt.js';

/**
 * Pure decision for a future Firestore-transactional execution gate.
 * No production payment executor invokes this yet.
 *
 * A timed-out POST has an ambiguous provider outcome. Expiration of a lease
 * MUST NOT authorize another POST without separate provider reconciliation.
 */
export const decidePrepaidRenewalPixExecutionGate = (input: {
  attempt: PrepaidRenewalPixAttempt;
  expectedStoreId: string;
  expectedProposalId: string;
  expectedRequestDigest: string;
  executionState: 'idle' | 'in_flight' | 'outcome_unknown';
  nowMs: number;
}): 'claim' | 'fetch_bound' => {
  const { attempt, expectedStoreId, expectedProposalId, expectedRequestDigest,
    executionState, nowMs } = input;
  if (!Number.isFinite(nowMs) ||
      attempt.storeId !== expectedStoreId ||
      attempt.proposalId !== expectedProposalId ||
      attempt.requestDigest !== expectedRequestDigest ||
      attempt.status !== 'reserved' ||
      attempt.idempotencyKey !== `prepaid-renewal-${expectedProposalId}`) {
    throw new Error('RENEWAL_PIX_EXECUTION_GATE_CONFLICT');
  }
  if (attempt.providerPaymentId !== undefined) {
    if (!/^\d{1,32}$/.test(attempt.providerPaymentId)) {
      throw new Error('RENEWAL_PIX_EXECUTION_GATE_CONFLICT');
    }
    return 'fetch_bound';
  }
  if (executionState !== 'idle') {
    throw new Error('RENEWAL_PIX_EXECUTION_OUTCOME_UNRESOLVED');
  }
  if (!Number.isFinite(Date.parse(attempt.expiresAt)) ||
      Date.parse(attempt.expiresAt) <= nowMs) {
    throw new Error('RENEWAL_PIX_EXECUTION_GATE_EXPIRED');
  }
  return 'claim';
};
