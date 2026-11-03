import type { buildPrepaidRenewalPixRequest } from './prepaidRenewalPixRequest.js';

type PixRequest = ReturnType<typeof buildPrepaidRenewalPixRequest>;

/**
 * Fail-closed, side-effect-free preflight for the future server-owned payment
 * transport. Never accept the seller identity from a client or from Pix metadata.
 * The credential scope and account ID must come from independently verified
 * commercial recipient authority and the OAuth vault.
 */
export const validatePrepaidRenewalPixTransportAuthority = (input: {
  storeId: string;
  proposalId: string;
  request: PixRequest;
  trustedCredentialScopeId: string;
  oauthCredentialScopeId: string;
  trustedExternalAccountId: string;
  oauthExternalAccountId: string;
}): void => {
  const { storeId, proposalId, request } = input;
  if (!/^[a-zA-Z0-9_-]{1,128}$/.test(storeId) ||
      !/^[a-f0-9]{64}$/.test(proposalId) ||
      request.path !== '/v1/payments' ||
      request.init.method !== 'POST' ||
      request.init.headers['X-Idempotency-Key'] !== `prepaid-renewal-${proposalId}` ||
      !input.trustedCredentialScopeId ||
      input.trustedCredentialScopeId !== input.oauthCredentialScopeId ||
      !/^\d+$/.test(input.trustedExternalAccountId) ||
      input.trustedExternalAccountId !== input.oauthExternalAccountId) {
    throw new Error('RENEWAL_PIX_TRANSPORT_AUTHORITY_MISMATCH');
  }
  let body: Record<string, unknown>;
  try { body = JSON.parse(request.init.body); }
  catch { throw new Error('RENEWAL_PIX_TRANSPORT_AUTHORITY_MISMATCH'); }
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    throw new Error('RENEWAL_PIX_TRANSPORT_AUTHORITY_MISMATCH');
  }
  const metadata = body.metadata;
  if (!metadata || typeof metadata !== 'object' || Array.isArray(metadata) ||
      (metadata as Record<string, unknown>).kyrub_store_id !== storeId ||
      (metadata as Record<string, unknown>).kyrub_prepaid_renewal_proposal_id !== proposalId ||
      body.external_reference !== `kyrub:prepaid-renewal:${storeId}:${proposalId}` ||
      body.payment_method_id !== 'pix' ||
      typeof body.transaction_amount !== 'number' ||
      !Number.isFinite(body.transaction_amount) ||
      body.transaction_amount <= 0) {
    throw new Error('RENEWAL_PIX_TRANSPORT_AUTHORITY_MISMATCH');
  }
};
