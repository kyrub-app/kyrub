import type { buildPrepaidRenewalPixRequest } from './prepaidRenewalPixRequest.js';
import type { PrepaidRenewalPixAttempt } from './prepaidRenewalPixAttempt.js';
import { decidePrepaidRenewalPixRecovery } from './prepaidRenewalPixRetryPolicy.js';
import { validatePrepaidRenewalPixCreationResponse } from './prepaidRenewalPixCreationResponse.js';

type PixRequest = ReturnType<typeof buildPrepaidRenewalPixRequest>;

/**
 * Isolated orchestration only. All persistence and transport are injected;
 * this module does not import the live Mercado Pago transport or Firebase.
 * Do not expose it through a production HTTP route without security review.
 */
export const executeIsolatedPrepaidRenewalPix = async (input: {
  storeId: string;
  proposalId: string;
  request: PixRequest;
  expectedCollectorId: string;
  reserve: () => Promise<{ attempt: PrepaidRenewalPixAttempt }>;
  createPayment: (request: PixRequest) => Promise<unknown>;
  fetchPayment: (paymentId: string) => Promise<unknown>;
  bindPayment: (paymentId: string) => Promise<'bound' | 'already_bound'>;
  /** Optional internal gate; when provided, claim before an unbound provider POST. */
  claimExecution?: () => Promise<'claimed' | 'fetch_bound'>;
  /** Persist an ambiguous outcome after provider transport failure; never reset the claim. */
  markOutcomeUnknown?: () => Promise<void>;
}): Promise<{ paymentId: string; binding: 'bound' | 'already_bound' }> => {
  const reserved = await input.reserve();
  const decision = decidePrepaidRenewalPixRecovery({
    storeId: input.storeId,
    proposalId: input.proposalId,
    request: input.request,
    persistedAttempt: reserved.attempt,
  });
  if (decision.action !== 'fetch_existing' && input.claimExecution) {
    const claim = await input.claimExecution();
    if (claim !== 'claimed') {
      throw new Error('RENEWAL_PIX_EXECUTION_GATE_CONFLICT');
    }
  }
  let response: unknown;
  if (decision.action === 'fetch_existing') {
    response = await input.fetchPayment(decision.paymentId!);
  } else {
    try {
      response = await input.createPayment(input.request);
    } catch (error) {
      if (input.markOutcomeUnknown) {
        try { await input.markOutcomeUnknown(); }
        catch { throw new Error('RENEWAL_PIX_OUTCOME_MARK_FAILED', { cause: error }); }
      }
      throw error;
    }
  }
  let paymentId: string;
  try {
    paymentId = validatePrepaidRenewalPixCreationResponse({
      request: input.request,
      response,
      expectedStoreId: input.storeId,
      expectedProposalId: input.proposalId,
      expectedCollectorId: input.expectedCollectorId,
    });
  } catch (error) {
    // A malformed or mismatched creation response does not prove the POST
    // failed. Preserve the claim and require reconciliation before retry.
    if (decision.action !== 'fetch_existing' && input.markOutcomeUnknown) {
      try { await input.markOutcomeUnknown(); }
      catch { throw new Error('RENEWAL_PIX_OUTCOME_MARK_FAILED', { cause: error }); }
    }
    throw error;
  }
  if (decision.action === 'fetch_existing' && paymentId !== decision.paymentId) {
    throw new Error('RENEWAL_PIX_RECOVERY_CONFLICT');
  }
  return { paymentId, binding: await input.bindPayment(paymentId) };
};
