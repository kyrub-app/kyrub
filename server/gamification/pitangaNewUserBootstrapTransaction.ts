import type { CollectionReference, DocumentReference, Transaction } from 'firebase-admin/firestore';
import { isWelcomeCampaignEligible } from './firstLoginWelcome.js';

/**
 * New-account-only bootstrap primitive. NOT connected to any API or login
 * handler: callers must independently prove the legacy writers are fenced.
 * Never use this primitive for a historical user or for migration.
 */
export const initializeNewUserPitangaBalanceInTransaction = async (
  tx: Transaction,
  input: {
    userId: string;
    firebaseCreatedAt: string;
    campaignEffectiveAt: string;
    legacyWritersFenced: boolean;
    fenceEpoch: string;
    fenceRef: DocumentReference;
    ledgerRef: CollectionReference;
    balanceRef: DocumentReference;
    receiptRef: DocumentReference;
  },
): Promise<{ initialized: boolean; balance: number }> => {
  const uid = input.userId;
  if (!/^[A-Za-z0-9_-]{1,128}$/.test(uid) ||
      !isWelcomeCampaignEligible(input.firebaseCreatedAt, input.campaignEffectiveAt) ||
      !input.legacyWritersFenced ||
      !/^[A-Za-z0-9_-]{1,128}$/.test(input.fenceEpoch) ||
      input.fenceRef.path !== 'systemControl/pitangaLegacyWriterFence' ||
      input.ledgerRef.path !== `users/${uid}/rewardLedger` ||
      input.balanceRef.path !== `users/${uid}/pitangaBalance/balance` ||
      input.receiptRef.path !== `users/${uid}/pitangaNewUserBootstrap/receipt`) {
    throw Error('PITANGA_NEW_USER_BOOTSTRAP_UNVERIFIED');
  }
  // Read the entire historical ledger, not a limit(1) query. If anything
  // exists, a separate verified migration is required.
  const [fence, ledger, balance, receipt] = await Promise.all([
    tx.get(input.fenceRef), tx.get(input.ledgerRef),
    tx.get(input.balanceRef), tx.get(input.receiptRef),
  ]);
  const fenceData = fence.data();
  if (!fence.exists || fenceData?.status !== 'fenced' ||
      fenceData?.writersVerified !== true ||
      fenceData?.epoch !== input.fenceEpoch) {
    throw Error('PITANGA_NEW_USER_BOOTSTRAP_FENCE_UNVERIFIED');
  }
  if (balance.exists || receipt.exists) {
    if (!balance.exists || !receipt.exists ||
        balance.data()?.userId !== uid ||
        !Number.isSafeInteger(balance.data()?.availableKCoins) ||
        balance.data()!.availableKCoins < 0 ||
        receipt.data()?.userId !== uid ||
        receipt.data()?.fenceEpoch !== input.fenceEpoch ||
        receipt.data()?.firebaseCreatedAt !== input.firebaseCreatedAt) {
      throw Error('PITANGA_NEW_USER_BOOTSTRAP_CONFLICT');
    }
    return { initialized: false, balance: balance.data()!.availableKCoins };
  }
  if (!ledger.empty) throw Error('PITANGA_NEW_USER_BOOTSTRAP_HISTORICAL_LEDGER');
  tx.create(input.balanceRef, { userId: uid, availableKCoins: 0, initializedBy: 'verified_new_user', fenceEpoch: input.fenceEpoch });
  tx.create(input.receiptRef, {
    userId: uid, firebaseCreatedAt: input.firebaseCreatedAt,
    fenceEpoch: input.fenceEpoch, initialBalance: 0,
  });
  return { initialized: true, balance: 0 };
};
