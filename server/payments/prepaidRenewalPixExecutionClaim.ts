import { adminDb } from '../firebaseAdmin.js';
import type { PrepaidRenewalPixAttempt } from './prepaidRenewalPixAttempt.js';
import { decidePrepaidRenewalPixExecutionGate } from './prepaidRenewalPixExecutionGate.js';

/**
 * Transactional single-claim gate for an unbound Pix attempt.
 * This is internal-only and is NOT connected to a production payment route.
 *
 * Once claimed, a lost provider response remains outcome_unknown. Do not
 * reset the state based on a timer: a POST may have reached the provider.
 */
export const claimPrepaidRenewalPixExecution = async (input: {
  storeId: string;
  proposalId: string;
  expectedRequestDigest: string;
}): Promise<'claimed' | 'fetch_bound'> => {
  if (!/^[a-zA-Z0-9_-]{1,128}$/.test(input.storeId) ||
      !/^[a-f0-9]{64}$/.test(input.proposalId) ||
      !/^[a-f0-9]{64}$/.test(input.expectedRequestDigest)) {
    throw new Error('RENEWAL_PIX_EXECUTION_GATE_CONFLICT');
  }
  const ref = adminDb.doc(
    `stores/${input.storeId}/prepaidRenewalPixAttempts/${input.proposalId}`
  );
  return adminDb.runTransaction(async tx => {
    const snapshot = await tx.get(ref);
    if (!snapshot.exists) throw new Error('RENEWAL_PIX_EXECUTION_GATE_CONFLICT');
    const attempt = snapshot.data() as PrepaidRenewalPixAttempt & {
      executionState?: 'idle' | 'in_flight' | 'outcome_unknown';
    };
    const decision = decidePrepaidRenewalPixExecutionGate({
      attempt,
      expectedStoreId: input.storeId,
      expectedProposalId: input.proposalId,
      expectedRequestDigest: input.expectedRequestDigest,
      executionState: attempt.executionState ?? 'idle',
      nowMs: Date.now(),
    });
    if (decision === 'fetch_bound') return 'fetch_bound';
    tx.update(ref, { executionState: 'in_flight' });
    return 'claimed';
  });
};

/**
 * Fail-closed transition after a network error. Even if the process crashes
 * before this update, in_flight is itself non-retryable without reconciliation.
 */
export const markPrepaidRenewalPixExecutionOutcomeUnknown = async (input: {
  storeId: string;
  proposalId: string;
  expectedRequestDigest: string;
}): Promise<void> => {
  if (!/^[a-zA-Z0-9_-]{1,128}$/.test(input.storeId) ||
      !/^[a-f0-9]{64}$/.test(input.proposalId) ||
      !/^[a-f0-9]{64}$/.test(input.expectedRequestDigest)) {
    throw new Error('RENEWAL_PIX_EXECUTION_GATE_CONFLICT');
  }
  const ref = adminDb.doc(
    `stores/${input.storeId}/prepaidRenewalPixAttempts/${input.proposalId}`
  );
  await adminDb.runTransaction(async tx => {
    const snapshot = await tx.get(ref);
    const attempt = snapshot.data() as (PrepaidRenewalPixAttempt & {
      executionState?: string;
    }) | undefined;
    if (!attempt || attempt.storeId !== input.storeId ||
        attempt.proposalId !== input.proposalId ||
        attempt.requestDigest !== input.expectedRequestDigest ||
        attempt.status !== 'reserved' ||
        attempt.executionState !== 'in_flight') {
      throw new Error('RENEWAL_PIX_EXECUTION_GATE_CONFLICT');
    }
    tx.update(ref, { executionState: 'outcome_unknown' });
  });
};
