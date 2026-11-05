/** Pure seller-identity recheck at the last boundary before a Pix POST. */
export const createPrepaidRenewalPixSellerRecheckingTransport = (input: {
  trustedCredentialScopeId: string;
  trustedExternalAccountId: string;
  resolveCurrentRecipient: () => Promise<{ credentialScopeId: string; externalAccountId: string }>;
  sellerScopedRequest: (scope: string, path: string, init: RequestInit) => Promise<unknown>;
}) => async (scope: string, path: string, init: RequestInit): Promise<unknown> => {
  if (init.method === 'POST') {
    const current = await input.resolveCurrentRecipient();
    if (!current.credentialScopeId || !current.externalAccountId ||
        scope !== input.trustedCredentialScopeId ||
        current.credentialScopeId !== input.trustedCredentialScopeId ||
        current.externalAccountId !== input.trustedExternalAccountId) {
      throw new Error('RENEWAL_PIX_TRANSPORT_AUTHORITY_MISMATCH');
    }
  }
  return input.sellerScopedRequest(scope, path, init);
};
