import { createHash } from 'node:crypto';
import type { buildPrepaidRenewalPixRequest } from './prepaidRenewalPixRequest.js';
import type { PrepaidRenewalPixAttempt } from './prepaidRenewalPixAttempt.js';
import { claimPrepaidRenewalPixExecution, markPrepaidRenewalPixExecutionOutcomeUnknown } from './prepaidRenewalPixExecutionClaim.js';
import { executeScopedIsolatedPrepaidRenewalPix } from './prepaidRenewalPixScopedExecution.js';

type PixRequest = ReturnType<typeof buildPrepaidRenewalPixRequest>;

/**
 * Internal-only composition with mandatory Firestore execution gate.
 * NOT an HTTP endpoint. The caller must authenticate the buyer, verify the
 * accepted proposal and resolve trusted seller OAuth authority independently.
 * This adapter does not connect to a live Mercado Pago transport.
 */
export const executeLockedIsolatedPrepaidRenewalPix = async (input: {
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
  const expectedRequestDigest = createHash('sha256').update(input.request.init.body).digest('hex');
  const locator = {
    storeId: input.storeId,
    proposalId: input.proposalId,
    expectedRequestDigest,
  };
  return executeScopedIsolatedPrepaidRenewalPix({
    ...input,
    claimExecution: () => claimPrepaidRenewalPixExecution(locator),
    markOutcomeUnknown: () => markPrepaidRenewalPixExecutionOutcomeUnknown(locator),
  });
};
