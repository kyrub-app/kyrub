import type { buildPrepaidRenewalPixRequest } from './prepaidRenewalPixRequest.js';
import { validatePrepaidRenewalPixTransportAuthority } from './prepaidRenewalPixTransportAuthority.js';
import { selectUniquePrepaidRenewalPixReconciliationPayment } from './prepaidRenewalPixReconciliationSelection.js';

type PixRequest = ReturnType<typeof buildPrepaidRenewalPixRequest>;

/**
 * Internal-only seller OAuth GET /v1/payments/search adapter. All pages are
 * validated before selecting any payment. No provider POST, live credentials
 * or production route is included here.
 */
export const searchUniqueSellerPrepaidRenewalPixPayment = async (input: {
  storeId: string;
  proposalId: string;
  request: PixRequest;
  trustedCredentialScopeId: string;
  oauthCredentialScopeId: string;
  trustedExternalAccountId: string;
  oauthExternalAccountId: string;
  sellerScopedRequest: (scope: string, path: string, init: RequestInit) => Promise<unknown>;
}): Promise<unknown> => {
  validatePrepaidRenewalPixTransportAuthority(input);
  const body = JSON.parse(input.request.init.body) as Record<string, unknown>;
  const reference = body.external_reference;
  if (typeof reference !== 'string' ||
      reference !== `kyrub:prepaid-renewal:${input.storeId}:${input.proposalId}`) {
    throw new Error('RENEWAL_PIX_RECONCILIATION_SEARCH_INVALID');
  }
  const all: unknown[] = [];
  const limit = 50;
  for (let offset = 0; offset <= 10000; offset += limit) {
    const params = new URLSearchParams({
      external_reference: reference, limit: String(limit),
      offset: String(offset), sort: 'id', criteria: 'asc',
    });
    const raw = await input.sellerScopedRequest(
      input.trustedCredentialScopeId,
      `/v1/payments/search?${params.toString()}`,
      { method: 'GET' },
    );
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
      throw new Error('RENEWAL_PIX_RECONCILIATION_SEARCH_INVALID');
    }
    const page = raw as Record<string, unknown>;
    const paging = page.paging as Record<string, unknown> | undefined;
    if (!paging || typeof paging.total !== 'number' || !Number.isSafeInteger(paging.total) ||
        typeof paging.offset !== 'number' || !Number.isSafeInteger(paging.offset) ||
        typeof paging.limit !== 'number' || !Number.isSafeInteger(paging.limit) ||
        (paging.total as number) < 0 ||
        paging.offset !== offset || paging.limit !== limit ||
        !Array.isArray(page.results) ||
        page.results.length > limit ||
        offset + page.results.length > (paging.total as number) ||
        (offset + page.results.length < (paging.total as number) && page.results.length !== limit)) {
      throw new Error('RENEWAL_PIX_RECONCILIATION_SEARCH_INCOMPLETE');
    }
    all.push(...page.results);
    if (all.length > 100) {
      throw new Error('RENEWAL_PIX_RECONCILIATION_SEARCH_INCOMPLETE');
    }
    if (offset + page.results.length === paging.total) {
      return selectUniquePrepaidRenewalPixReconciliationPayment({
        request: input.request, expectedStoreId: input.storeId,
        expectedProposalId: input.proposalId,
        expectedCollectorId: input.trustedExternalAccountId,
        providerPayments: all, searchComplete: true,
      });
    }
  }
  throw new Error('RENEWAL_PIX_RECONCILIATION_SEARCH_INCOMPLETE');
};
