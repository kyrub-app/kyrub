import { createHash } from 'node:crypto';
import { activatePrepaidContractAfterVerifiedPayment, calculatePrepaidRenewalPeriod } from './prepaidSubscriptionContractLifecycle.js';
import {
  acceptSubscriptionRenewalProposal,
  confirmPrepaidRenewalPayment,
  snapshotAcceptedPrepaidRenewal,
  type SubscriptionRenewalProposal,
} from '../../shared/subscriptionContractRenewal.js';
import { persistVerifiedPrepaidRenewal } from './persistedPrepaidRenewal.js';
import { adminDb } from '../firebaseAdmin.js';
import { verifyPrepaidRenewalMercadoPagoPayment } from './prepaidRenewalPaymentVerification.js';
import { authenticateConsultantRequest } from '../ai/consultantAuth.js';
import { resolveCommercialRecipientAuthority } from './commercialRecipientAuthorityService.js';
import { resolvePrepaidRenewalRecipientBinding } from './prepaidRenewalRecipientBinding.js';

/**
 * Server-only composition boundary. Inputs MUST originate from an authenticated,
 * persisted acceptance and a freshly verified provider payment. Not an HTTP route.
 */
export const recordVerifiedPrepaidRenewal = async (input: {
  proposal: SubscriptionRenewalProposal;
  acceptance: Parameters<typeof acceptSubscriptionRenewalProposal>[1];
  payment: { id: string; status: string; amountMinor: number; occurredAt: string; verifiedByProvider: boolean };
  newContractId: string;
  acceptedProposalId?: string;
}) => {
  if (!input.payment.verifiedByProvider || input.payment.status !== 'approved') {
    throw new Error('RENEWAL_PAYMENT_NOT_CONFIRMED');
  }
  if (!Number.isFinite(Date.parse(input.payment.occurredAt)) ||
      !input.payment.occurredAt.endsWith('Z')) {
    throw new Error('INVALID_RENEWAL_PAYMENT_TIMESTAMP');
  }
  // A payment approved before the buyer accepted this specific proposal
  // cannot fulfill the renewal, even when the provider later reports approved.
  if (Date.parse(input.payment.occurredAt) < Date.parse(input.acceptance.acceptedAt)) {
    throw new Error('RENEWAL_PAYMENT_PRECEDES_ACCEPTANCE');
  }
  const accepted = acceptSubscriptionRenewalProposal(input.proposal, input.acceptance);
  const paid = confirmPrepaidRenewalPayment(accepted, {
    providerPaymentId: input.payment.id,
    status: input.payment.status,
    amountMinor: input.payment.amountMinor,
    verifiedByProvider: input.payment.verifiedByProvider,
  });
  const lifecycle = activatePrepaidContractAfterVerifiedPayment({
    state: 'pending_payment', months: paid.months, amountMinor: paid.totalDueMinor,
    providerPaymentId: '', paymentConfirmedAt: '', startsAt: '', expiresAt: '',
  }, input.payment);
  // Load the historical expiry from the authoritative store, never from a
  // browser-supplied quote. An early renewal extends the previous term.
  const safeId = (value: unknown): value is string =>
    typeof value === 'string' && value.length > 0 && value.length <= 180 && !value.includes('/');
  if (!safeId(paid.storeId) || !safeId(paid.previousContractId)) {
    throw new Error('INVALID_RENEWAL_PREDECESSOR');
  }
  const previousDoc = await adminDb.doc(
    `stores/${paid.storeId}/prepaidSubscriptionContracts/${paid.previousContractId}`
  ).get();
  if (!previousDoc.exists || previousDoc.get('storeId') !== paid.storeId ||
      previousDoc.get('contractId') !== paid.previousContractId ||
      previousDoc.get('customerId') !== paid.customerId ||
      previousDoc.get('productId') !== paid.productId ||
      previousDoc.get('months') !== paid.months) {
    throw new Error('RENEWAL_PREDECESSOR_CONTRACT_MISMATCH');
  }
  const period = calculatePrepaidRenewalPeriod({
    previousExpiresAt: previousDoc.get('expiresAt'),
    acceptedAt: input.acceptance.acceptedAt,
    paymentApprovedAt: lifecycle.paymentConfirmedAt,
    months: paid.months,
  });
  const snapshot = snapshotAcceptedPrepaidRenewal(paid, {
    newContractId: input.newContractId,
    startsAt: period.startsAt,
    expiresAt: period.expiresAt,
  });
  return persistVerifiedPrepaidRenewal(snapshot, input.acceptedProposalId);
};

/** Load a stored renewal quote and acceptance; never trust a browser-supplied quote. */
export const loadAcceptedPrepaidRenewal = async (input: {
  storeId: string; proposalId: string; authenticatedBuyerId: string;
}): Promise<{
  proposal: SubscriptionRenewalProposal;
  acceptance: Parameters<typeof acceptSubscriptionRenewalProposal>[1];
}> => {
  const safe = (s: string) => typeof s === 'string' && s.length > 0 && s.length <= 180 && !s.includes('/');
  if (![input.storeId, input.proposalId, input.authenticatedBuyerId].every(safe)) {
    throw new Error('INVALID_RENEWAL_IDENTITY');
  }
  const doc = await adminDb.doc(`stores/${input.storeId}/prepaidRenewalProposals/${input.proposalId}`).get();
  if (!doc.exists) throw new Error('RENEWAL_PROPOSAL_NOT_FOUND');
  const data = doc.data() as Record<string, unknown>;
  const proposal = data.proposal as SubscriptionRenewalProposal | undefined;
  const acceptance = data.acceptance as Parameters<typeof acceptSubscriptionRenewalProposal>[1] | undefined;
  if (!proposal || !acceptance || data.status !== 'accepted' ||
      data.acceptedProposalDigest !== createHash('sha256').update(JSON.stringify(proposal)).digest('hex') ||
      ![3, 6, 12].includes(proposal.months) ||
      typeof proposal.previousContractId !== 'string' || !safe(proposal.previousContractId) ||
      typeof data.acceptedBy !== 'string' || data.acceptedBy !== input.authenticatedBuyerId ||
      proposal.storeId !== input.storeId ||
      proposal.customerId !== input.authenticatedBuyerId ||
      acceptance.customerId !== input.authenticatedBuyerId ||
      acceptance.storeId !== input.storeId ||
      data.acceptedAt !== acceptance.acceptedAt ||
      !Number.isSafeInteger(proposal.totalDueMinor) || proposal.totalDueMinor <= 0 ||
      acceptance.acceptedTotalMinor !== proposal.totalDueMinor ||
      typeof data.createdAt !== 'string' ||
      !Number.isFinite(Date.parse(data.createdAt)) ||
      typeof acceptance.acceptedAt !== 'string' ||
      !Number.isFinite(Date.parse(acceptance.acceptedAt)) ||
      Date.parse(acceptance.acceptedAt) < Date.parse(data.createdAt)) {
    throw new Error('RENEWAL_ACCEPTANCE_REQUIRED');
  }
  acceptSubscriptionRenewalProposal(proposal, acceptance);
  return { proposal, acceptance };
};

/** Entry point for authenticated server handlers after provider-side verification. */
export const recordStoredVerifiedPrepaidRenewal = async (input: {
  storeId: string;
  proposalId: string;
  authenticatedBuyerId: string;
  payment: Parameters<typeof recordVerifiedPrepaidRenewal>[0]['payment'];
  newContractId: string;
}) => {
  const stored = await loadAcceptedPrepaidRenewal(input);
  return recordVerifiedPrepaidRenewal({
    ...stored, payment: input.payment, newContractId: input.newContractId,
    acceptedProposalId: input.proposalId,
  });
};

/** Server boundary: use stored offer, authenticated buyer and provider-verified payment. */
export const recordPrepaidRenewalWithVerifiedSources = async (input: {
  authorization: string | null | undefined;
  storeId: string;
  proposalId: string;
  paymentId: string;
}) => {
  // The server, not the client, determines the successor contract identity.
  // Reconciliation of the same verified payment must target the same document.
  if (!/^[a-zA-Z0-9_-]{1,128}$/.test(input.storeId) ||
      !/^[a-f0-9]{64}$/.test(input.proposalId) ||
      !/^\d{1,32}$/.test(input.paymentId)) {
    throw new Error('INVALID_RENEWAL_RECONCILIATION_REQUEST');
  }
  const newContractId = 'renewal-' + createHash('sha256').update(
    JSON.stringify([input.storeId, input.proposalId, input.paymentId])
  ).digest('hex');
  const buyer = await authenticateConsultantRequest(input.authorization);
  const stored = await loadAcceptedPrepaidRenewal({
    storeId: input.storeId,
    proposalId: input.proposalId,
    authenticatedBuyerId: buyer.uid,
  });
  const proposalRef = adminDb.doc(`stores/${input.storeId}/prepaidRenewalProposals/${input.proposalId}`);
  const proposalDoc = await proposalRef.get();
  if (!proposalDoc.exists) throw new Error('RENEWAL_PROPOSAL_NOT_FOUND');
  const data = proposalDoc.data() as Record<string, unknown>;
  // Recheck the accepted snapshot immediately before consulting the provider.
  // Never reconcile against a proposal that was replaced or reopened.
  if (data.status !== 'accepted' ||
      data.acceptedBy !== buyer.uid ||
      JSON.stringify(data.proposal) !== JSON.stringify(stored.proposal) ||
      JSON.stringify(data.acceptance) !== JSON.stringify(stored.acceptance)) {
    throw new Error('RENEWAL_ACCEPTANCE_CHANGED');
  }
  const sellerCredentialScopeId = data.sellerCredentialScopeId;
  const paymentExternalReference = data.paymentExternalReference;
  if (typeof sellerCredentialScopeId !== 'string' ||
      typeof paymentExternalReference !== 'string' ||
      (!sellerCredentialScopeId || sellerCredentialScopeId.length > 180 || sellerCredentialScopeId.includes('/')) ||
      paymentExternalReference !== `kyrub:prepaid-renewal:${input.storeId}:${input.proposalId}`) {
    throw new Error('RENEWAL_CHECKOUT_BINDING_MISSING');
  }
  const authority = await resolveCommercialRecipientAuthority({
    context: 'store_subscription', canonicalStoreId: input.storeId,
  });
  const recipient = resolvePrepaidRenewalRecipientBinding({
    storeId: input.storeId, storedSellerCredentialScopeId: sellerCredentialScopeId, authority,
  });
  const payment = await verifyPrepaidRenewalMercadoPagoPayment({
    sellerCredentialScopeId: recipient.credentialScopeId,
    paymentId: input.paymentId,
    expectedExternalReference: paymentExternalReference,
    expectedAmountMinor: stored.proposal.totalDueMinor,
  });
  // A provider lookup is asynchronous: the accepted offer could change
  // while the payment is being verified. Re-read before recording a contract.
  const latest = await loadAcceptedPrepaidRenewal({
    storeId: input.storeId,
    proposalId: input.proposalId,
    authenticatedBuyerId: buyer.uid,
  });
  if (JSON.stringify(latest.proposal) !== JSON.stringify(stored.proposal) ||
      JSON.stringify(latest.acceptance) !== JSON.stringify(stored.acceptance)) {
    throw new Error('RENEWAL_ACCEPTANCE_CHANGED');
  }
  const latestDoc = await proposalRef.get();
  const latestData = latestDoc.data() as Record<string, unknown> | undefined;
  if (!latestData || latestData.sellerCredentialScopeId !== sellerCredentialScopeId ||
      latestData.paymentExternalReference !== paymentExternalReference) {
    throw new Error('RENEWAL_CHECKOUT_BINDING_MISSING');
  }
  return recordVerifiedPrepaidRenewal({
    ...latest, payment, newContractId, acceptedProposalId: input.proposalId,
  });
};
