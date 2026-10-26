import { Timestamp } from 'firebase-admin/firestore';
import { adminDb } from '../firebaseAdmin.js';
import { quoteMarketplaceLaunchPolicyAt } from '../../shared/marketplaceLaunchPolicyProposal.js';

/**
 * Read-only, server-authoritative quote preview.
 * This is NOT a payment charge, fee allocation or payout instruction.
 * An absent/invalid activation record must not be treated as a free trial.
 */
export const previewMarketplaceStoreCommercialFees = async (input: {
  storeId: string;
  eligibleProductsMinor: number;
  orderCreatedIso: string;
}): Promise<{
  policyId: string;
  firstActivatedAt: string;
  merchantCommissionMinor: number;
  consumerServiceFeeMinor: number;
  merchantExempt: boolean;
}> => {
  const storeId = input.storeId.trim();
  if (!storeId || storeId.includes('/')) throw new Error('Invalid store identity.');
  const snapshot = await adminDb.doc(`stores/${storeId}`).get();
  if (!snapshot.exists) throw new Error('Store not found.');
  const store = snapshot.data() ?? {};
  if (store.publicationStatus !== 'published') {
    throw new Error('Store is not commercially published.');
  }
  const activatedAt = store.firstMarketplaceActivatedAt;
  if (!(activatedAt instanceof Timestamp)) {
    throw new Error('First activation is unverified; fee quote requires reconciliation.');
  }
  const firstActivatedAt = activatedAt.toDate().toISOString();
  return {
    policyId: 'marketplace-launch-v1-proposal',
    firstActivatedAt,
    ...quoteMarketplaceLaunchPolicyAt({
      eligibleProductsMinor: input.eligibleProductsMinor,
      firstActivationIso: firstActivatedAt,
      orderCreatedIso: input.orderCreatedIso,
    }),
  };
};
