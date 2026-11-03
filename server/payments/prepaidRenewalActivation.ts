import { activatePrepaidContractAfterVerifiedPayment } from './prepaidSubscriptionContractLifecycle.js';
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

/**
 * Server-only composition boundary. Inputs MUST originate from an authenticated,
 * persisted acceptance and a freshly verified provider payment. Not an HTTP route.
 */
export const recordVerifiedPrepaidRenewal = async (input: {
  proposal: SubscriptionRenewalProposal;
  acceptance: Parameters<typeof acceptSubscriptionRenewalProposal>[1];
  payment: { id: string; status: string; amountMinor: number; occurredAt: string; verifiedByProvider: boolean };
  newContractId: string;
}) => {
  if (!input.payment.verifiedByProvider || input.payment.status !== 'approved') {
    throw new Error('RENEWAL_PAYMENT_NOT_CONFIRMED');
  }
  if (!Number.isFinite(Date.parse(input.payment.occurredAt)) ||
      !input.payment.occurredAt.endsWith('Z')) {
    throw new Error('INVALID_RENEWAL_PAYMENT_TIMESTAMP');
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
  const snapshot = snapshotAcceptedPrepaidRenewal(paid, {
    newContractId: input.newContractId,
    startsAt: lifecycle.startsAt,
    expiresAt: lifecycle.expiresAt,
  });
  return persistVerifiedPrepaidRenewal(snapshot);
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
      typeof acceptance.acceptedAt !== 'string' ||
      !Number.isFinite(Date.parse(acceptance.acceptedAt))) {
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
  return recordVerifiedPrepaidRenewal({ ...stored, payment: input.payment, newContractId: input.newContractId });
};

/** Server boundary: use stored offer, authenticated buyer and provider-verified payment. */
export const recordPrepaidRenewalWithVerifiedSources = async (input: {
  authorization: string | null | undefined;
  storeId: string;
  proposalId: string;
  paymentId: string;
  newContractId: string;
}) => {
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
  const sellerCredentialScopeId = data.sellerCredentialScopeId;
  const paymentExternalReference = data.paymentExternalReference;
  if (typeof sellerCredentialScopeId !== 'string' ||
      typeof paymentExternalReference !== 'string' ||
      sellerCredentialScopeId !== input.storeId ||
      paymentExternalReference !== `kyrub:prepaid-renewal:${input.storeId}:${input.proposalId}`) {
    throw new Error('RENEWAL_CHECKOUT_BINDING_MISSING');
  }
  const payment = await verifyPrepaidRenewalMercadoPagoPayment({
    sellerCredentialScopeId,
    paymentId: input.paymentId,
    expectedExternalReference: paymentExternalReference,
    expectedAmountMinor: stored.proposal.totalDueMinor,
  });
  return recordVerifiedPrepaidRenewal({
    ...stored, payment, newContractId: input.newContractId,
  });
};
