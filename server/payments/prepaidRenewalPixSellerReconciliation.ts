import { createHash } from 'node:crypto';
import { adminDb } from '../firebaseAdmin.js';
import type { buildPrepaidRenewalPixRequest } from './prepaidRenewalPixRequest.js';
import { searchUniqueSellerPrepaidRenewalPixPayment } from './prepaidRenewalPixSellerSearch.js';
import { reconcileUnknownPrepaidRenewalPixPayment } from './prepaidRenewalPixReconciliation.js';

type PixRequest = ReturnType<typeof buildPrepaidRenewalPixRequest>;

/**
 * Internal-only composition: trusted seller-scoped provider GET/search followed
 * by an immutable Firestore binding. Never accepts a browser-supplied payment
 * ID or provider response. Does not issue POST /v1/payments.
 *
 * The caller must authenticate the buyer and resolve the seller's OAuth
 * authority on the server before invoking this function.
 */
export const reconcileUnknownSellerPrepaidRenewalPixPayment = async (input: {
  storeId: string;
  proposalId: string;
  request: PixRequest;
  trustedCredentialScopeId: string;
  oauthCredentialScopeId: string;
  trustedExternalAccountId: string;
  oauthExternalAccountId: string;
  sellerScopedRequest: (scope: string, path: string, init: RequestInit) => Promise<unknown>;
}): Promise<'bound' | 'already_bound'> => {
  // Fail closed before any provider GET if the caller's request differs from
  // the immutable reservation or the attempt was never sent to the provider.
  if (!/^[a-zA-Z0-9_-]{1,128}$/.test(input.storeId) ||
      !/^[a-f0-9]{64}$/.test(input.proposalId)) {
    throw new Error('RENEWAL_PIX_RECONCILIATION_CONFLICT');
  }
  const digest = createHash('sha256').update(input.request.init.body).digest('hex');
  const snapshot = await adminDb.doc(
    `stores/${input.storeId}/prepaidRenewalPixAttempts/${input.proposalId}`,
  ).get();
  const attempt = snapshot.data();
  if (!attempt || attempt.storeId !== input.storeId ||
      attempt.proposalId !== input.proposalId ||
      attempt.status !== 'reserved' ||
      attempt.requestDigest !== digest ||
      attempt.idempotencyKey !== `prepaid-renewal-${input.proposalId}` ||
      !['in_flight', 'outcome_unknown'].includes(attempt.executionState)) {
    throw new Error('RENEWAL_PIX_RECONCILIATION_CONFLICT');
  }
  const trustedProviderPayment = await searchUniqueSellerPrepaidRenewalPixPayment(input);
  return reconcileUnknownPrepaidRenewalPixPayment({
    storeId: input.storeId,
    proposalId: input.proposalId,
    request: input.request,
    expectedCollectorId: input.trustedExternalAccountId,
    trustedProviderPayment,
  });
};
