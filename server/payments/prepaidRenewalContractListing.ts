import { adminDb } from '../firebaseAdmin.js';
import { authenticateConsultantRequest } from '../ai/consultantAuth.js';
import { resolveCanonicalStoreIdentity } from '../identity/canonicalStoreIdentityService.js';
import type { SubscriptionRenewalProposal } from '../../shared/subscriptionContractRenewal.js';

const validId = (value: unknown): value is string =>
  typeof value === 'string' && /^[a-zA-Z0-9_-]{1,128}$/.test(value);

/**
 * Owner-only, read-only selector for existing prepaid contracts.
 * Never expose customer contracts to an unauthenticated browser or another store.
 */
export const listOwnerPrepaidRenewalContracts = async (input: {
  authorization: string | null | undefined;
  storeId: string;
}): Promise<{ contracts: Array<{
  id: string;
  productId: string;
  customerId: string;
  months: number;
  expiresAt: string;
}> }> => {
  if (!validId(input.storeId)) throw new Error('INVALID_RENEWAL_STORE_ID');
  const actor = await authenticateConsultantRequest(input.authorization);
  const identity = await resolveCanonicalStoreIdentity(input.storeId, {
    requirePublishedTenant: true,
  });
  if (identity.canonicalStoreId !== input.storeId || identity.ownerUserId !== actor.uid) {
    throw new Error('RENEWAL_SELLER_NOT_AUTHORIZED');
  }
  const snapshot = await adminDb.collection(
    `stores/${input.storeId}/prepaidSubscriptionContracts`
  ).limit(100).get();
  return {
    contracts: snapshot.docs.flatMap(doc => {
      const data = doc.data();
      if (!validId(doc.id) || !validId(data.productId) ||
          !validId(data.customerId) || ![3, 6, 12].includes(data.months) ||
          typeof data.expiresAt !== 'string' ||
          !Number.isFinite(Date.parse(data.expiresAt))) return [];
      return [{
        id: doc.id,
        productId: data.productId,
        customerId: data.customerId,
        months: data.months,
        expiresAt: data.expiresAt,
      }];
    }),
  };
};

/** Buyer-only read: never return another customer's proposals. */
export const listBuyerPrepaidRenewalProposals = async (input: {
  authorization: string | null | undefined;
  storeId: string;
}): Promise<{ proposals: Array<{
  id: string;
  status: 'awaiting_acceptance' | 'accepted';
  proposal: SubscriptionRenewalProposal;
}> }> => {
  if (!validId(input.storeId)) throw new Error('INVALID_RENEWAL_STORE_ID');
  const buyer = await authenticateConsultantRequest(input.authorization);
  const identity = await resolveCanonicalStoreIdentity(input.storeId, {
    requirePublishedTenant: true,
  });
  if (identity.canonicalStoreId !== input.storeId) {
    throw new Error('INVALID_RENEWAL_STORE_ID');
  }
  const snapshot = await adminDb.collection(
    `stores/${input.storeId}/prepaidRenewalProposals`
  ).where('proposal.customerId', '==', buyer.uid).limit(100).get();
  return {
    proposals: snapshot.docs.flatMap(doc => {
      const data = doc.data();
      const proposal = data.proposal as SubscriptionRenewalProposal | undefined;
      if (!/^[a-f0-9]{64}$/.test(doc.id) ||
          !proposal || proposal.customerId !== buyer.uid ||
          proposal.storeId !== input.storeId ||
          ![3, 6, 12].includes(proposal.months) ||
          !Number.isSafeInteger(proposal.totalDueMinor) ||
          proposal.totalDueMinor <= 0 ||
          !['awaiting_acceptance', 'accepted'].includes(data.status)) return [];
      return [{
        id: doc.id,
        status: data.status as 'awaiting_acceptance' | 'accepted',
        proposal,
      }];
    }),
  };
};
