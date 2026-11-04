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
  const trustedProviderPayment = await searchUniqueSellerPrepaidRenewalPixPayment(input);
  return reconcileUnknownPrepaidRenewalPixPayment({
    storeId: input.storeId,
    proposalId: input.proposalId,
    request: input.request,
    expectedCollectorId: input.trustedExternalAccountId,
    trustedProviderPayment,
  });
};
