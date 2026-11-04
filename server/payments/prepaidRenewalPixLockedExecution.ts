import { createHash } from 'node:crypto';
import { prepareAuthenticatedPrepaidRenewalPix } from './prepaidRenewalCheckoutPreparation.js';
import { reservePrepaidRenewalPixAttempt } from './prepaidRenewalPixAttemptReservation.js';
import { bindCreatedPrepaidRenewalPixPaymentId } from './prepaidRenewalPixPaymentIdBinding.js';
import { validatePrepaidRenewalPixTransportAuthority } from './prepaidRenewalPixTransportAuthority.js';
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

/**
 * Internal-only authenticated checkout composition. Caller must independently
 * resolve trusted commercial recipient and OAuth vault identity on the server.
 * No public HTTP route or live Mercado Pago transport is connected here.
 */
export const executeAuthenticatedLockedIsolatedPrepaidRenewalPix = async (input: {
  authorization: string | null | undefined;
  storeId: string;
  proposalId: string;
  trustedCredentialScopeId: string;
  oauthCredentialScopeId: string;
  trustedExternalAccountId: string;
  oauthExternalAccountId: string;
  sellerScopedRequest: (scope: string, path: string, init: RequestInit) => Promise<unknown>;
}) => {
  const request = await prepareAuthenticatedPrepaidRenewalPix({
    authorization: input.authorization,
    storeId: input.storeId,
    proposalId: input.proposalId,
  });
  validatePrepaidRenewalPixTransportAuthority({ ...input, request });
  const expectedRequestDigest = createHash('sha256').update(request.init.body).digest('hex');
  return executeLockedIsolatedPrepaidRenewalPix({
    ...input,
    request,
    reserve: () => reservePrepaidRenewalPixAttempt({
      storeId: input.storeId, proposalId: input.proposalId, request,
    }),
    bindPayment: paymentId => bindCreatedPrepaidRenewalPixPaymentId({
      storeId: input.storeId, proposalId: input.proposalId,
      paymentId, expectedRequestDigest,
    }),
  });
};
