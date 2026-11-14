import type { DocumentReference, Transaction } from 'firebase-admin/firestore';
import type { KyrubChallengeDefinition } from '../../shared/gamification.js';
import { planFirstStorePublishedReward, type VerifiedFirstStorePublication } from './firstStorePublishedReward.js';

/** Must run in the same Firestore transaction as publication evidence verification. */
export async function awardVerifiedFirstStorePublicationInTransaction(
  tx: Transaction,
  input: {
    challenge: KyrubChallengeDefinition;
    event: VerifiedFirstStorePublication;
    receiptRef: DocumentReference;
    xpLedgerRef: DocumentReference;
    pitangaLedgerRef: DocumentReference;
  },
): Promise<{ replay: boolean; pitangas: 0; xp: 2 }> {
  const plan = planFirstStorePublishedReward(input.challenge, input.event);
  const id = plan.idempotencyKey;
  const uid = plan.userId;
  if (input.receiptRef.path !== `users/${uid}/challengeRewards/${id}` ||
      input.xpLedgerRef.path !== `users/${uid}/xpLedger/xp_${id}` ||
      input.pitangaLedgerRef.path !== `users/${uid}/rewardLedger/earn_${id}`) {
    throw Error('FIRST_STORE_PUBLICATION_REWARD_REFERENCE_INVALID');
  }
  const [receipt, xp, pitanga] = await Promise.all([
    tx.get(input.receiptRef), tx.get(input.xpLedgerRef), tx.get(input.pitangaLedgerRef),
  ]);
  if (pitanga.exists) throw Error('FIRST_STORE_PUBLICATION_REWARD_LEDGER_CONFLICT');
  if (receipt.exists) {
    const saved = receipt.data();
    const entry = xp.data();
    const validReceipt = saved?.userId === uid && saved?.storeId === plan.storeId &&
      saved?.idempotencyKey === id && saved?.xp === 2 && saved?.pitangas === 0 &&
      (saved?.challengeId === 'first_store_created' || saved?.challengeId === plan.challengeId);
    const validXp = xp.exists && entry?.userId === uid && entry?.deltaXp === 2 &&
      entry?.economy === 'kyrub_xp' && entry?.sourceType === 'challenge' &&
      entry?.sourceId === saved?.challengeId && entry?.correlationId === id &&
      entry?.idempotencyKey === id && entry?.occurredAt === saved?.occurredAt;
    if (!validReceipt || !validXp) throw Error('FIRST_STORE_PUBLICATION_REWARD_IDEMPOTENCY_CONFLICT');
    return { replay: true, pitangas: 0, xp: 2 };
  }
  if (xp.exists) throw Error('FIRST_STORE_PUBLICATION_REWARD_PARTIAL_STATE');
  tx.create(input.xpLedgerRef, {
    id: input.xpLedgerRef.id, userId: uid, deltaXp: 2,
    sourceType: 'challenge', sourceId: plan.challengeId,
    correlationId: id, idempotencyKey: id,
    occurredAt: input.event.publishedAt, economy: 'kyrub_xp',
  });
  tx.create(input.receiptRef, {
    userId: uid, storeId: plan.storeId, challengeId: plan.challengeId,
    pitangas: 0, xp: 2, idempotencyKey: id, occurredAt: input.event.publishedAt,
  });
  return { replay: false, pitangas: 0, xp: 2 };
}
