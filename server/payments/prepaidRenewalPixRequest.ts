/**
 * Server-only payload for the existing seller-scoped Mercado Pago Pix transport.
 * No network I/O here: the caller must load the accepted Firestore proposal,
 * authenticate the buyer, and resolve/verify the merchant OAuth account.
 */
export const buildPrepaidRenewalPixRequest = (input: {
  storeId: string;
  proposalId: string;
  acceptedBuyerId: string;
  authenticatedBuyerId: string;
  acceptedTotalMinor: number;
  proposalTotalMinor: number;
  sellerCredentialScopeId: string;
  verifiedSellerCredentialScopeId?: string;
  paymentExternalReference: string;
  payerEmail: string;
  expiresAt: string;
}) => {
  if (!/^[a-zA-Z0-9_-]{1,128}$/.test(input.storeId) ||
      !/^[a-f0-9]{64}$/.test(input.proposalId) ||
      !input.acceptedBuyerId || input.acceptedBuyerId !== input.authenticatedBuyerId ||
      input.sellerCredentialScopeId !== (input.verifiedSellerCredentialScopeId ?? input.storeId) ||
      input.paymentExternalReference !==
        `kyrub:prepaid-renewal:${input.storeId}:${input.proposalId}` ||
      !Number.isSafeInteger(input.acceptedTotalMinor) ||
      input.acceptedTotalMinor <= 0 ||
      input.acceptedTotalMinor !== input.proposalTotalMinor ||
      !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(input.payerEmail) ||
      typeof input.expiresAt !== 'string' ||
      !Number.isFinite(Date.parse(input.expiresAt)) ||
      Date.parse(input.expiresAt) <= Date.now()) {
    throw new Error('INVALID_PREPAID_RENEWAL_PIX_BINDING');
  }
  return {
    path: '/v1/payments' as const,
    init: {
      method: 'POST' as const,
      headers: { 'X-Idempotency-Key': `prepaid-renewal-${input.proposalId}` },
      body: JSON.stringify({
        transaction_amount: input.proposalTotalMinor / 100,
        description: 'Renovação antecipada Kyrub',
        payment_method_id: 'pix',
        payer: { email: input.payerEmail },
        date_of_expiration: input.expiresAt,
        external_reference: input.paymentExternalReference,
        metadata: {
          kyrub_store_id: input.storeId,
          kyrub_prepaid_renewal_proposal_id: input.proposalId,
        },
      }),
    },
  };
};


/**
 * Read-only retry gate. A payment executor must retrieve the originally
 * persisted attempt and compare its exact request before making any POST.
 * A matching idempotency key alone does not prove that the payload is stable.
 */
export const assertSamePrepaidRenewalPixAttempt = (
  original: ReturnType<typeof buildPrepaidRenewalPixRequest>,
  retry: ReturnType<typeof buildPrepaidRenewalPixRequest>,
): void => {
  if (original.path !== retry.path ||
      original.init.method !== retry.init.method ||
      original.init.headers['X-Idempotency-Key'] !== retry.init.headers['X-Idempotency-Key'] ||
      original.init.body !== retry.init.body) {
    throw new Error('RENEWAL_PIX_ATTEMPT_PAYLOAD_CHANGED');
  }
};
