import { createHash } from 'node:crypto';
import { adminDb } from '../firebaseAdmin.js';
import {
  createSubscriptionRenewalProposal,
  type AcceptedSubscriptionContract,
} from '../../shared/subscriptionContractRenewal.js';

const safeId = (value: unknown): value is string =>
  typeof value === 'string' && value.length > 0 && value.length <= 180 && !value.includes('/');

/**
 * Internal seller-side operation. Caller MUST authorize the seller and obtain
 * currentMonthlyPriceMinor/discountPercent from the authoritative price and
 * promotion services. This is deliberately not a public endpoint.
 */
export const createPersistedPrepaidRenewalProposal = async (input: {
  storeId: string;
  previousContractId: string;
  currentMonthlyPriceMinor: number;
  discountPercent: number;
}): Promise<{ proposalId: string; paymentExternalReference: string }> => {
  if (!safeId(input.storeId) || !safeId(input.previousContractId) ||
      !Number.isSafeInteger(input.currentMonthlyPriceMinor) ||
      input.currentMonthlyPriceMinor <= 0) {
    throw new Error('INVALID_RENEWAL_PROPOSAL_INPUT');
  }
  const previousRef = adminDb.doc(
    `stores/${input.storeId}/prepaidSubscriptionContracts/${input.previousContractId}`
  );
  const previousDoc = await previousRef.get();
  if (!previousDoc.exists) throw new Error('RENEWAL_PREVIOUS_CONTRACT_NOT_FOUND');
  const previous = previousDoc.data() as AcceptedSubscriptionContract;
  if (previous.storeId !== input.storeId ||
      previous.contractId !== input.previousContractId ||
      !safeId(previous.customerId) || !safeId(previous.productId) ||
      ![3, 6, 12].includes(previous.months)) {
    throw new Error('INVALID_RENEWAL_PREVIOUS_CONTRACT');
  }
  const successorRef = adminDb.doc(`stores/${input.storeId}/prepaidRenewalSuccessors/${input.previousContractId}`);
  const successor = await successorRef.get();
  if (successor.exists) throw new Error('RENEWAL_PREDECESSOR_ALREADY_RENEWED');
  const proposal = createSubscriptionRenewalProposal(
    previous, input.currentMonthlyPriceMinor, input.discountPercent
  );
  const proposalId = createHash('sha256').update(
    JSON.stringify([input.storeId, input.previousContractId,
      input.currentMonthlyPriceMinor, input.discountPercent])
  ).digest('hex');
  const paymentExternalReference = `kyrub:prepaid-renewal:${input.storeId}:${proposalId}`;
  const proposalRef = adminDb.doc(
    `stores/${input.storeId}/prepaidRenewalProposals/${proposalId}`
  );
  await adminDb.runTransaction(async tx => {
    const [existing, alreadyRenewed] = await Promise.all([tx.get(proposalRef), tx.get(successorRef)]);
    if (alreadyRenewed.exists) throw new Error('RENEWAL_PREDECESSOR_ALREADY_RENEWED');
    if (existing.exists) {
      const data = existing.data();
      if (JSON.stringify(data?.proposal) !== JSON.stringify(proposal) ||
          data?.sellerCredentialScopeId !== input.storeId ||
          data?.paymentExternalReference !== paymentExternalReference) {
        throw new Error('RENEWAL_PROPOSAL_CONFLICT');
      }
      return;
    }
    tx.create(proposalRef, {
      status: 'awaiting_acceptance',
      proposal,
      sellerCredentialScopeId: input.storeId,
      paymentExternalReference,
      createdAt: new Date().toISOString(),
    });
  });
  return { proposalId, paymentExternalReference };
};
