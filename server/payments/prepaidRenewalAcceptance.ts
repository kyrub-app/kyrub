import { adminDb } from '../firebaseAdmin.js';
import { authenticateConsultantRequest } from '../ai/consultantAuth.js';
import {
  acceptSubscriptionRenewalProposal,
  type SubscriptionRenewalProposal,
} from '../../shared/subscriptionContractRenewal.js';

const safeId = (value: string): boolean =>
  typeof value === 'string' && value.length > 0 && value.length <= 180 && !value.includes('/');

/**
 * Internal server-only acceptance recorder. Caller must establish the buyer
 * identity from a verified auth token; never accept it from request JSON.
 * The proposal must already be persisted by a trusted seller-side operation.
 */
export const persistAuthenticatedPrepaidRenewalAcceptance = async (input: {
  storeId: string;
  proposalId: string;
  authenticatedBuyerId: string;
  acceptedTotalMinor: number;
}): Promise<'accepted' | 'already_accepted'> => {
  if (![input.storeId, input.proposalId, input.authenticatedBuyerId].every(safeId)) {
    throw new Error('INVALID_RENEWAL_IDENTITY');
  }
  const reference = adminDb.doc(`stores/${input.storeId}/prepaidRenewalProposals/${input.proposalId}`);
  const predecessorPath = `stores/${input.storeId}/prepaidRenewalSuccessors/`;
  return adminDb.runTransaction(async tx => {
    const snapshot = await tx.get(reference);
    if (!snapshot.exists) throw new Error('RENEWAL_PROPOSAL_NOT_FOUND');
    const data = snapshot.data() as Record<string, unknown>;
    const proposal = data.proposal as SubscriptionRenewalProposal | undefined;
    if (!proposal || proposal.storeId !== input.storeId ||
        proposal.customerId !== input.authenticatedBuyerId ||
        ![3, 6, 12].includes(proposal.months) ||
        !Number.isSafeInteger(input.acceptedTotalMinor) ||
        input.acceptedTotalMinor <= 0) {
      throw new Error('RENEWAL_ACCEPTANCE_REQUIRED');
    }
    if (!safeId(proposal.previousContractId)) throw new Error('INVALID_RENEWAL_PREDECESSOR');
    const successor = await tx.get(adminDb.doc(predecessorPath + proposal.previousContractId));
    if (successor.exists) throw new Error('RENEWAL_PREDECESSOR_ALREADY_RENEWED');
    if (data.status === 'accepted') {
      const previous = data.acceptance as { customerId?: string; storeId?: string; acceptedTotalMinor?: number } | undefined;
      if (data.acceptedBy === input.authenticatedBuyerId &&
          previous?.customerId === input.authenticatedBuyerId &&
          previous?.storeId === input.storeId &&
          previous?.acceptedTotalMinor === input.acceptedTotalMinor &&
          data.acceptedAt === (data.acceptance as { acceptedAt?: string } | undefined)?.acceptedAt &&
          Number.isFinite(Date.parse(String(data.acceptedAt)))) return 'already_accepted';
      throw new Error('RENEWAL_ALREADY_ACCEPTED');
    }
    if (data.status !== 'awaiting_acceptance') throw new Error('RENEWAL_NOT_OPEN');
    const acceptedAt = new Date().toISOString();
    const acceptance = {
      customerId: input.authenticatedBuyerId,
      storeId: input.storeId,
      acceptedTotalMinor: input.acceptedTotalMinor,
      acceptedAt,
    };
    acceptSubscriptionRenewalProposal(proposal, acceptance);
    tx.update(reference, {
      status: 'accepted',
      acceptedBy: input.authenticatedBuyerId,
      acceptedAt,
      acceptance,
    });
    return 'accepted';
  });
};

/** Authenticated boundary: derive buyer identity only from verified Firebase token. */
export const acceptPrepaidRenewalWithFirebaseAuth = async (input: {
  authorization: string | null | undefined;
  storeId: string;
  proposalId: string;
  acceptedTotalMinor: number;
}) => {
  const user = await authenticateConsultantRequest(input.authorization);
  return persistAuthenticatedPrepaidRenewalAcceptance({
    storeId: input.storeId,
    proposalId: input.proposalId,
    acceptedTotalMinor: input.acceptedTotalMinor,
    authenticatedBuyerId: user.uid,
  });
};
