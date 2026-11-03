import { adminDb } from '../firebaseAdmin.js';
import { authenticateConsultantRequest } from '../ai/consultantAuth.js';
import { loadAcceptedPrepaidRenewal } from './prepaidRenewalActivation.js';
import { buildPrepaidRenewalPixRequest } from './prepaidRenewalPixRequest.js';
import { resolveCommercialRecipientAuthority } from './commercialRecipientAuthorityService.js';
import { resolvePrepaidRenewalRecipientBinding } from './prepaidRenewalRecipientBinding.js';
import { prepaidRenewalPixExpiryFromAcceptance } from './prepaidRenewalPixExpiry.js';

/**
 * Read-only authenticated checkout preparation. Does not contact Mercado Pago
 * or create any payment. The actual payment executor remains a separate gate.
 */
export const prepareAuthenticatedPrepaidRenewalPix = async (input: {
  authorization: string | null | undefined;
  storeId: string;
  proposalId: string;
}) => {
  if (!/^[a-zA-Z0-9_-]{1,128}$/.test(input.storeId) ||
      !/^[a-f0-9]{64}$/.test(input.proposalId)) {
    throw new Error('INVALID_RENEWAL_CHECKOUT_REQUEST');
  }
  const buyer = await authenticateConsultantRequest(input.authorization);
  const { proposal, acceptance } = await loadAcceptedPrepaidRenewal({
    storeId: input.storeId,
    proposalId: input.proposalId,
    authenticatedBuyerId: buyer.uid,
  });
  const snapshot = await adminDb.doc(
    `stores/${input.storeId}/prepaidRenewalProposals/${input.proposalId}`
  ).get();
  const data = snapshot.data() as Record<string, unknown> | undefined;
  if (!snapshot.exists || data?.status !== 'accepted' ||
      data.acceptedBy !== buyer.uid ||
      JSON.stringify(data.proposal) !== JSON.stringify(proposal) ||
      JSON.stringify(data.acceptance) !== JSON.stringify(acceptance) ||
      (typeof data.sellerCredentialScopeId !== 'string' ||
       !data.sellerCredentialScopeId || data.sellerCredentialScopeId.includes('/')) ||
      data.paymentExternalReference !==
        `kyrub:prepaid-renewal:${input.storeId}:${input.proposalId}`) {
    throw new Error('RENEWAL_CHECKOUT_BINDING_MISSING');
  }
  const authority = await resolveCommercialRecipientAuthority({
    context: 'store_subscription', canonicalStoreId: input.storeId,
  });
  const recipient = resolvePrepaidRenewalRecipientBinding({
    storeId: input.storeId,
    storedSellerCredentialScopeId: data.sellerCredentialScopeId,
    authority,
  });
  return buildPrepaidRenewalPixRequest({
    storeId: input.storeId,
    proposalId: input.proposalId,
    acceptedBuyerId: acceptance.customerId,
    authenticatedBuyerId: buyer.uid,
    acceptedTotalMinor: acceptance.acceptedTotalMinor,
    proposalTotalMinor: proposal.totalDueMinor,
    sellerCredentialScopeId: recipient.credentialScopeId,
    verifiedSellerCredentialScopeId: recipient.credentialScopeId,
    paymentExternalReference: data.paymentExternalReference as string,
    payerEmail: buyer.email,
    expiresAt: prepaidRenewalPixExpiryFromAcceptance(acceptance.acceptedAt),
  });
};
