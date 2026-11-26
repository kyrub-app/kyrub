import type { DocumentReference, Transaction } from 'firebase-admin/firestore';
import type { KyrubChallengeDefinition } from '../../shared/gamification.js';
import { planFirstStoreChallengeReward, type VerifiedFirstStoreEvent } from './firstStoreChallengeReward.js';

/**
 * Trusted transaction primitive. Call only after verifying store ownership and
 * first-store creation from the canonical store authority, within the same
 * transaction or an independently immutable server event.
 * No HTTP endpoint or automatic trigger is exposed here.
 */
export const awardVerifiedFirstStoreChallengeInTransaction = async (
  tx: Transaction,
  input: {
    challenge: KyrubChallengeDefinition;
    event: VerifiedFirstStoreEvent;
    balanceRef: DocumentReference;
    pitangaLedgerRef: DocumentReference;
    xpLedgerRef: DocumentReference;
    receiptRef: DocumentReference;
  },
): Promise<{ replay: boolean; pitangas: number; xp: number }> => {
  const plan = planFirstStoreChallengeReward(input.challenge, input.event);
  if (plan.pitangas !== 0 || plan.xp !== 2) throw new Error('FIRST_STORE_CHALLENGE_NOT_ELIGIBLE');
  const uid = plan.userId;
  const awardId = plan.idempotencyKey;
  if (input.balanceRef.path !== `users/${uid}/pitangaBalance/balance` ||
      input.pitangaLedgerRef.path !== `users/${uid}/rewardLedger/earn_${awardId}` ||
      input.xpLedgerRef.path !== `users/${uid}/xpLedger/xp_${awardId}` ||
      input.receiptRef.path !== `users/${uid}/challengeRewards/${awardId}`) {
    throw new Error('FIRST_STORE_REWARD_REFERENCE_INVALID');
  }
  const [receipt, xpEntry, pitangaEntry] = await Promise.all([
    tx.get(input.receiptRef), tx.get(input.xpLedgerRef), tx.get(input.pitangaLedgerRef),
  ]);
  const expected = {
    userId: uid, storeId: plan.storeId, challengeId: plan.challengeId,
    pitangas: plan.pitangas, xp: plan.xp, idempotencyKey: awardId,
    occurredAt: input.event.createdAt,
  };
  if (receipt.exists) {
    const recorded = receipt.data();
    if (Object.entries(expected).some(([key, value]) => recorded?.[key] !== value) ||
        (!xpEntry.exists || xpEntry.data()?.deltaXp !== plan.xp ||
        xpEntry.data()?.userId !== uid || xpEntry.data()?.sourceId !== plan.challengeId ||
        xpEntry.data()?.sourceType !== 'challenge' || xpEntry.data()?.economy !== 'kyrub_xp' ||
        xpEntry.data()?.correlationId !== awardId ||
        xpEntry.data()?.occurredAt !== input.event.createdAt ||
        xpEntry.data()?.idempotencyKey !== awardId) ||
      pitangaEntry.exists) {
      throw new Error('FIRST_STORE_REWARD_IDEMPOTENCY_CONFLICT');
    }
    return { replay: true, pitangas: plan.pitangas, xp: plan.xp };
  }
  if (xpEntry.exists || pitangaEntry.exists) throw new Error('FIRST_STORE_REWARD_PARTIAL_STATE');
  // The first-store award is XP-only; it never initializes or credits Pitangas.
  tx.create(input.xpLedgerRef, {
      id: input.xpLedgerRef.id, userId: uid, deltaXp: plan.xp,
      sourceType: 'challenge', sourceId: plan.challengeId,
      correlationId: awardId, idempotencyKey: awardId,
      occurredAt: input.event.createdAt, economy: 'kyrub_xp',
  });
  tx.create(input.receiptRef, expected);
  return { replay: false, pitangas: plan.pitangas, xp: plan.xp };
};
