import type { buildPrepaidRenewalPixRequest } from './prepaidRenewalPixRequest.js';
import { validatePrepaidRenewalPixCreationResponse } from './prepaidRenewalPixCreationResponse.js';

type PixRequest = ReturnType<typeof buildPrepaidRenewalPixRequest>;

/**
 * Pure fail-closed selector for a trusted, seller-scoped payment search.
 * A provider search returning no match is NOT evidence that the POST failed.
 * Duplicate matching payments require manual investigation, not arbitrary
 * selection. This function performs no network requests or Firestore writes.
 */
export const selectUniquePrepaidRenewalPixReconciliationPayment = (input: {
  request: PixRequest;
  expectedStoreId: string;
  expectedProposalId: string;
  expectedCollectorId: string;
  providerPayments: unknown;
  /** Server-verified completion of every provider search page. */
  searchComplete: boolean;
}): unknown => {
  if (input.searchComplete !== true) {
    throw new Error('RENEWAL_PIX_RECONCILIATION_SEARCH_INCOMPLETE');
  }
  if (!Array.isArray(input.providerPayments)) {
    throw new Error('RENEWAL_PIX_RECONCILIATION_SEARCH_INVALID');
  }
  if (input.providerPayments.length === 0) {
    throw new Error('RENEWAL_PIX_RECONCILIATION_NOT_FOUND_UNRESOLVED');
  }
  if (input.providerPayments.length > 100) {
    throw new Error('RENEWAL_PIX_RECONCILIATION_SEARCH_INCOMPLETE');
  }
  const matches: unknown[] = [];
  for (const payment of input.providerPayments) {
    try {
      validatePrepaidRenewalPixCreationResponse({
        request: input.request,
        response: payment,
        expectedStoreId: input.expectedStoreId,
        expectedProposalId: input.expectedProposalId,
        expectedCollectorId: input.expectedCollectorId,
      });
      matches.push(payment);
    } catch {
      // Other payments in the seller's search must never be adopted.
    }
  }
  if (matches.length === 0) {
    throw new Error('RENEWAL_PIX_RECONCILIATION_NOT_FOUND_UNRESOLVED');
  }
  if (matches.length !== 1) {
    throw new Error('RENEWAL_PIX_RECONCILIATION_AMBIGUOUS');
  }
  return matches[0];
};
