import { adminDb } from '../firebaseAdmin.js';
import { authenticateConsultantRequest } from '../ai/consultantAuth.js';
import { loadAcceptedPrepaidRenewal } from './prepaidRenewalActivation.js';
import { buildPrepaidRenewalPixRequest } from './prepaidRenewalPixRequest.js';
import { resolveCommercialRecipientAuthority } from './commercialRecipientAuthorityService.js';
import { resolvePrepaidRenewalRecipientBinding } from './prepaidRenewalRecipientBinding.js';
import { prepaidRenewalPixExpiryFromAcceptance } from './prepaidRenewalPixExpiry.js';
import { createHash } from 'node:crypto';

/**
 * Read-only authenticated checkout preparation. Does not contact Mercado Pago
 * or create any payment. The actual payment executor remains a separate gate.
 */
export const prepareAuthenticatedPrepaidRenewalPixWithRecipient = async (input: {
  authorization: string | null | undefined;
  storeId: string;
  proposalId: string;
  /** Reconstruct only a persisted request for provider GET/search; never authorizes a POST. */
  readOnlyRecovery?: boolean;
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
  // Never initiate a new Pix payment for a predecessor whose canonical
  // subscription entitlement cannot be verified. Recovery remains available
  // for already-started attempts; do not strand a paid buyer.
  if (!input.readOnlyRecovery) {
    const predecessor = await adminDb.doc(
      `stores/${input.storeId}/prepaidSubscriptionContracts/${proposal.previousContractId}`,
    ).get();
    const subscriptionId = predecessor.get('subscriptionId');
    if (!predecessor.exists || typeof subscriptionId !== 'string' ||
        !/^[a-zA-Z0-9_-]{1,180}$/.test(subscriptionId)) {
      throw new Error('RENEWAL_ENTITLEMENT_BINDING_NOT_VERIFIED');
    }
    const subscription = await adminDb.doc(
      `stores/${input.storeId}/subscriptions/${subscriptionId}`,
    ).get();
    if (predecessor.get('storeId') !== input.storeId ||
        predecessor.get('contractId') !== proposal.previousContractId ||
        predecessor.get('customerId') !== buyer.uid ||
        predecessor.get('productId') !== proposal.productId ||
        !subscription.exists || subscription.get('id') !== subscriptionId ||
        subscription.get('storeId') !== input.storeId ||
        subscription.get('buyerId') !== buyer.uid ||
        subscription.get('productId') !== proposal.productId) {
      throw new Error('RENEWAL_ENTITLEMENT_BINDING_NOT_VERIFIED');
    }
  }
  const authority = await resolveCommercialRecipientAuthority({
    context: 'store_subscription', canonicalStoreId: input.storeId,
  });
  const recipient = resolvePrepaidRenewalRecipientBinding({
    storeId: input.storeId,
    storedSellerCredentialScopeId: data.sellerCredentialScopeId,
    authority,
  });
  if (input.readOnlyRecovery) {
    const attemptDoc = await adminDb.doc(
      `stores/${input.storeId}/prepaidRenewalPixAttempts/${input.proposalId}`,
    ).get();
    const attempt = attemptDoc.data();
    if (attempt?.requestBody !== undefined) {
      let payload: Record<string, unknown>;
      try { payload = JSON.parse(attempt.requestBody); }
      catch { throw new Error('RENEWAL_PIX_RECOVERY_CONFLICT'); }
      if (!payload || typeof payload !== 'object' || Array.isArray(payload)) throw new Error('RENEWAL_PIX_RECOVERY_CONFLICT');
      const metadata = payload?.metadata as Record<string, unknown> | undefined;
      if (typeof attempt.requestBody !== 'string' ||
          attempt.storeId !== input.storeId || attempt.proposalId !== input.proposalId ||
          attempt.status !== 'reserved' ||
          attempt.requestDigest !== createHash('sha256').update(attempt.requestBody).digest('hex') ||
          attempt.idempotencyKey !== `prepaid-renewal-${input.proposalId}` ||
          payload.transaction_amount !== proposal.totalDueMinor / 100 ||
          payload.payment_method_id !== 'pix' ||
          payload.external_reference !== data.paymentExternalReference ||
          metadata?.kyrub_store_id !== input.storeId ||
          metadata?.kyrub_prepaid_renewal_proposal_id !== input.proposalId ||
          payload.date_of_expiration !== attempt.expiresAt ||
          attempt.expiresAt !== new Date(Date.parse(acceptance.acceptedAt) + 30 * 60_000).toISOString()) {
        throw new Error('RENEWAL_PIX_RECOVERY_CONFLICT');
      }
      return { recipient, request: {
        path: '/v1/payments' as const,
        init: { method: 'POST' as const,
          headers: { 'X-Idempotency-Key': `prepaid-renewal-${input.proposalId}` },
          body: attempt.requestBody as string },
      } };
    }
  }
  const request = buildPrepaidRenewalPixRequest({
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
  return { request, recipient };
};

/** Backward-compatible read-only request preparation. */
export const prepareAuthenticatedPrepaidRenewalPix = async (input: Parameters<typeof prepareAuthenticatedPrepaidRenewalPixWithRecipient>[0]) =>
  (await prepareAuthenticatedPrepaidRenewalPixWithRecipient(input)).request;
