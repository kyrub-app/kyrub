import type { buildPrepaidRenewalPixRequest } from './prepaidRenewalPixRequest.js';
import type { PrepaidRenewalPixAttempt } from './prepaidRenewalPixAttempt.js';
import { createAuthorityCheckedPrepaidRenewalPixTransport } from './prepaidRenewalPixScopedTransportAdapter.js';
import { executeAuthorityGuardedIsolatedPrepaidRenewalPix } from './prepaidRenewalPixAuthorityGuardedExecutor.js';

type PixRequest = ReturnType<typeof buildPrepaidRenewalPixRequest>;

/**
 * Isolated composition boundary. One trusted seller identity is used for
 * authority validation, provider transport and collector verification.
 * All effects are injected; no production endpoint or live secrets here.
 */
export const executeScopedIsolatedPrepaidRenewalPix = async (input: {
  storeId: string;
  proposalId: string;
  request: PixRequest;
  trustedCredentialScopeId: string;
  oauthCredentialScopeId: string;
  trustedExternalAccountId: string;
  oauthExternalAccountId: string;
  reserve: () => Promise<{ attempt: PrepaidRenewalPixAttempt }>;
  bindPayment: (paymentId: string) => Promise<'bound' | 'already_bound'>;
  sellerScopedRequest: (credentialScopeId: string, path: string, init: RequestInit) => Promise<unknown>;
}) => {
  const transport = createAuthorityCheckedPrepaidRenewalPixTransport(input);
  return executeAuthorityGuardedIsolatedPrepaidRenewalPix({
    ...input,
    createPayment: transport.createPayment,
    fetchPayment: transport.fetchPayment,
  });
};
