import type { buildPrepaidRenewalPixRequest } from './prepaidRenewalPixRequest.js';
import type { PrepaidRenewalPixAttempt } from './prepaidRenewalPixAttempt.js';
import { executeIsolatedPrepaidRenewalPix } from './prepaidRenewalPixIsolatedExecutor.js';
import { validatePrepaidRenewalPixTransportAuthority } from './prepaidRenewalPixTransportAuthority.js';

type PixRequest = ReturnType<typeof buildPrepaidRenewalPixRequest>;

/**
 * Isolated, injected-transport adapter. Verify the independently obtained
 * merchant authority and OAuth account BEFORE reserving or contacting a
 * provider. This module is not an HTTP route and never loads real secrets.
 */
export const executeAuthorityGuardedIsolatedPrepaidRenewalPix = async (input: {
  storeId: string;
  proposalId: string;
  request: PixRequest;
  trustedCredentialScopeId: string;
  oauthCredentialScopeId: string;
  trustedExternalAccountId: string;
  oauthExternalAccountId: string;
  reserve: () => Promise<{ attempt: PrepaidRenewalPixAttempt }>;
  createPayment: (request: PixRequest) => Promise<unknown>;
  fetchPayment: (paymentId: string) => Promise<unknown>;
  bindPayment: (paymentId: string) => Promise<'bound' | 'already_bound'>;
  claimExecution?: () => Promise<'claimed' | 'fetch_bound'>;
}) => {
  validatePrepaidRenewalPixTransportAuthority(input);
  return executeIsolatedPrepaidRenewalPix({
    storeId: input.storeId,
    proposalId: input.proposalId,
    request: input.request,
    expectedCollectorId: input.trustedExternalAccountId,
    reserve: input.reserve,
    createPayment: input.createPayment,
    fetchPayment: input.fetchPayment,
    bindPayment: input.bindPayment,
    claimExecution: input.claimExecution,
  });
};
