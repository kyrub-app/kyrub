import { createHash } from 'node:crypto';
import type { buildPrepaidRenewalPixRequest } from './prepaidRenewalPixRequest.js';
import { validatePrepaidRenewalPixCreationResponse } from './prepaidRenewalPixCreationResponse.js';
import { bindCreatedPrepaidRenewalPixPaymentId } from './prepaidRenewalPixPaymentIdBinding.js';

/**
 * Internal-only boundary for a trusted server-side Mercado Pago creation
 * response. It does NOT send a payment request, authenticate a merchant, or
 * expose a route. Only a server-owned payment transport may call this after
 * authenticating the buyer, verifying seller OAuth and reserving the attempt.
 *
 * The Firestore binding is immutable, transactional and checks the exact
 * request digest; a caller-controlled response is NOT proof of origin.
 */
export const bindVerifiedPrepaidRenewalPixCreation = async (input: {
  storeId: string;
  proposalId: string;
  expectedCollectorId: string;
  request: ReturnType<typeof buildPrepaidRenewalPixRequest>;
  trustedProviderResponse: unknown;
}): Promise<{ paymentId: string; action: 'bound' | 'already_bound' }> => {
  const paymentId = validatePrepaidRenewalPixCreationResponse({
    request: input.request,
    response: input.trustedProviderResponse,
    expectedStoreId: input.storeId,
    expectedProposalId: input.proposalId,
    expectedCollectorId: input.expectedCollectorId,
  });
  const expectedRequestDigest = createHash('sha256')
    .update(input.request.init.body).digest('hex');
  const action = await bindCreatedPrepaidRenewalPixPaymentId({
    storeId: input.storeId,
    proposalId: input.proposalId,
    paymentId,
    expectedRequestDigest,
  });
  return { paymentId, action };
};
