import type { Firestore } from 'firebase-admin/firestore';
import { FIRST_STORE_CHALLENGE_ID } from './firstStoreChallengeReward.js';
import { awardVerifiedFirstStoreChallengeInTransaction } from './firstStoreChallengeAwardTransaction.js';

/**
 * Trusted-only integration adapter. Not called by a public route.
 * The canonical store and challenge are verified inside the same transaction
 * that writes both reward ledgers. An unbootstrapped Pitanga balance fails closed.
 */
export const awardFirstStoreChallengeForCanonicalStore = async (
  db: Firestore,
  input: { userId: string; canonicalStoreId: string },
) => {
  const { userId, canonicalStoreId } = input;
  if (!/^[A-Za-z0-9_-]{1,128}$/.test(userId) ||
      !/^[A-Za-z0-9_-]{1,128}$/.test(canonicalStoreId)) {
    throw new Error('FIRST_STORE_AWARD_INPUT_INVALID');
  }
  const storeRef = db.doc(`stores/${canonicalStoreId}`);
  const challengeRef = db.doc(`global_challenges/${FIRST_STORE_CHALLENGE_ID}`);
  const userRoot = db.collection('users').doc(userId);
  const awardId = `first_store_${userId}`;
  return db.runTransaction(async tx => {
    const [store, challenge] = await Promise.all([tx.get(storeRef), tx.get(challengeRef)]);
    const data = store.data();
    const activatedAt = data?.activatedAt;
    const date = typeof activatedAt === 'string' ? new Date(activatedAt) : activatedAt?.toDate?.();
    // A canonical store created before activation may not represent a first
    // store. The first-store marker must be asserted by the provisioning writer.
    if (!store.exists || data?.ownerId !== userId || data?.id !== canonicalStoreId ||
        data?.firstStoreCreationVerified !== true ||
        !(date instanceof Date) || !Number.isFinite(date.getTime())) {
      throw new Error('FIRST_STORE_EVENT_UNVERIFIED');
    }
    if (!challenge.exists) throw new Error('FIRST_STORE_CHALLENGE_NOT_FOUND');
    return awardVerifiedFirstStoreChallengeInTransaction(tx, {
      challenge: challenge.data() as Parameters<typeof awardVerifiedFirstStoreChallengeInTransaction>[1]['challenge'],
      event: {
        userId, storeId: canonicalStoreId,
        createdAt: date.toISOString(), isFirstStore: true,
      },
      balanceRef: userRoot.collection('pitangaBalance').doc('balance'),
      pitangaLedgerRef: userRoot.collection('rewardLedger').doc(`earn_${awardId}`),
      xpLedgerRef: userRoot.collection('xpLedger').doc(`xp_${awardId}`),
      receiptRef: userRoot.collection('challengeRewards').doc(awardId),
    });
  });
};
