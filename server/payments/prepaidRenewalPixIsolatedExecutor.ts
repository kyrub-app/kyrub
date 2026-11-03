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
}): Promise<{ paymentId: string; binding: 'bound' | 'already_bound' }> => {
  const reserved = await input.reserve();
  const decision = decidePrepaidRenewalPixRecovery({
    storeId: input.storeId,
    proposalId: input.proposalId,
    request: input.request,
    persistedAttempt: reserved.attempt,
  });
  const response = decision.action === 'fetch_existing'
    ? await input.fetchPayment(decision.paymentId!)
    : await input.createPayment(input.request);
  const paymentId = validatePrepaidRenewalPixCreationResponse({
    request: input.request,
    response,
    expectedStoreId: input.storeId,
    expectedProposalId: input.proposalId,
    expectedCollectorId: input.expectedCollectorId,
  });
  if (decision.action === 'fetch_existing' && paymentId !== decision.paymentId) {
    throw new Error('RENEWAL_PIX_RECOVERY_CONFLICT');
  }
  return { paymentId, binding: await input.bindPayment(paymentId) };
};
