import type { CommercialRecipientAuthority } from '../../shared/commercialRecipientAuthority.js';

/**
 * Normalize the merchant identity for a prepaid renewal. The canonical store
 * and the legacy OAuth credential scope are deliberately distinct identities.
 * The stored proposal may carry the canonical store id from older versions;
 * that value is not an OAuth credential scope and must never be used as one.
 */
export const resolvePrepaidRenewalRecipientBinding = (input: {
  storeId: string;
  storedSellerCredentialScopeId: unknown;
  authority: CommercialRecipientAuthority;
}): { credentialScopeId: string; externalAccountId: string } => {
  const { storeId, storedSellerCredentialScopeId, authority } = input;
  if (!storeId || !/^[a-zA-Z0-9_-]{1,128}$/.test(storeId) ||
      authority.context !== 'store_subscription' ||
      authority.recipientKind !== 'merchant_store' ||
      authority.credentialAuthority !== 'store_oauth_vault' ||
      authority.canonicalStoreId !== storeId ||
      !authority.ownerUserId ||
      authority.credentialScopeId !== authority.ownerUserId ||
      !/^\d+$/.test(authority.externalAccountId) ||
      (storedSellerCredentialScopeId !== storeId &&
       storedSellerCredentialScopeId !== authority.credentialScopeId)) {
    throw new Error('RENEWAL_RECIPIENT_AUTHORITY_MISMATCH');
  }
  return {
    credentialScopeId: authority.credentialScopeId,
    externalAccountId: authority.externalAccountId,
  };
};
