import { createHash } from 'node:crypto';
import { prepareAuthenticatedPrepaidRenewalPixWithRecipient } from './prepaidRenewalCheckoutPreparation.js';
import { reservePrepaidRenewalPixAttempt } from './prepaidRenewalPixAttemptReservation.js';
import { bindCreatedPrepaidRenewalPixPaymentId } from './prepaidRenewalPixPaymentIdBinding.js';
import { validatePrepaidRenewalPixTransportAuthority } from './prepaidRenewalPixTransportAuthority.js';
import type { buildPrepaidRenewalPixRequest } from './prepaidRenewalPixRequest.js';
import type { PrepaidRenewalPixAttempt } from './prepaidRenewalPixAttempt.js';
import { claimPrepaidRenewalPixExecution, markPrepaidRenewalPixExecutionOutcomeUnknown } from './prepaidRenewalPixExecutionClaim.js';
import { executeScopedIsolatedPrepaidRenewalPix } from './prepaidRenewalPixScopedExecution.js';
import { resolveCommercialRecipientAuthority } from './commercialRecipientAuthorityService.js';
import { resolvePrepaidRenewalRecipientBinding } from './prepaidRenewalRecipientBinding.js';
import { createPrepaidRenewalPixSellerRecheckingTransport } from './prepaidRenewalPixSellerRecheckingTransport.js';

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

/** Reject a transport identity that differs from the authenticated seller binding. */
export const assertAuthenticatedPrepaidRenewalPixRecipient = (input: {
  recipient: { credentialScopeId: string; externalAccountId: string };
  trustedCredentialScopeId: string;
  trustedExternalAccountId: string;
}): void => {
  if (!input.recipient.credentialScopeId || !input.recipient.externalAccountId ||
      input.trustedCredentialScopeId !== input.recipient.credentialScopeId ||
      input.trustedExternalAccountId !== input.recipient.externalAccountId) {
    throw new Error('RENEWAL_PIX_TRANSPORT_AUTHORITY_MISMATCH');
  }
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
  const { request, recipient } = await prepareAuthenticatedPrepaidRenewalPixWithRecipient({
    authorization: input.authorization,
    storeId: input.storeId,
    proposalId: input.proposalId,
  });
  assertAuthenticatedPrepaidRenewalPixRecipient({ ...input, recipient });
  validatePrepaidRenewalPixTransportAuthority({ ...input, request });
  const expectedRequestDigest = createHash('sha256').update(request.init.body).digest('hex');
  return executeLockedIsolatedPrepaidRenewalPix({
    ...input,
    request,
    // Recheck the current seller binding after the transactional claim and
    // immediately before any provider POST; a stale OAuth account must fail closed.
    sellerScopedRequest: createPrepaidRenewalPixSellerRecheckingTransport({
      trustedCredentialScopeId: input.trustedCredentialScopeId,
      trustedExternalAccountId: input.trustedExternalAccountId,
      sellerScopedRequest: input.sellerScopedRequest,
      resolveCurrentRecipient: async () => {
        const currentAuthority = await resolveCommercialRecipientAuthority({
          context: 'store_subscription', canonicalStoreId: input.storeId,
        });
        return resolvePrepaidRenewalRecipientBinding({
          storeId: input.storeId,
          storedSellerCredentialScopeId: recipient.credentialScopeId,
          authority: currentAuthority,
        });
      },
    }),
    reserve: () => reservePrepaidRenewalPixAttempt({
      storeId: input.storeId, proposalId: input.proposalId, request,
    }),
    bindPayment: paymentId => bindCreatedPrepaidRenewalPixPaymentId({
      storeId: input.storeId, proposalId: input.proposalId,
      paymentId, expectedRequestDigest,
    }),
  });
};
