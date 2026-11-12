import type { DocumentReference, Transaction } from 'firebase-admin/firestore';

/**
 * Trusted-server primitive only. Not an API or an earning trigger.
 * The caller must resolve the SAME canonical balance reference used by
 * conversions and redemptions, after historical ledger reconciliation.
 * Never initialize a missing balance from zero.
 */
export const applyPitangaEarnInTransaction = async (
  tx: Transaction,
  input: {
    userId: string;
    awardId: string;
    sourceType: 'challenge' | 'campaign' | 'admin_adjustment';
    sourceId: string;
    amount: number;
    occurredAt: string;
    balanceRef: DocumentReference;
    ledgerRef: DocumentReference;
  },
): Promise<{ balance: number; replay: boolean }> => {
  if (!/^[A-Za-z0-9_-]{1,128}$/.test(input.userId) ||
      !/^[A-Za-z0-9_-]{1,128}$/.test(input.awardId) ||
      !/^[A-Za-z0-9_-]{1,128}$/.test(input.sourceId) ||
      !['challenge', 'campaign', 'admin_adjustment'].includes(input.sourceType) ||
      !Number.isSafeInteger(input.amount) || input.amount <= 0 ||
      !Number.isFinite(Date.parse(input.occurredAt))) {
    throw new Error('PITANGA_EARN_INPUT_INVALID');
  }
  const root = `users/${input.userId}/`;
  if (input.balanceRef.path !== `${root}pitangaBalance/balance` ||
      input.ledgerRef.parent.path !== `users/${input.userId}/rewardLedger` ||
      input.balanceRef.parent.path === `users/${input.userId}/rewardLedger` ||
      input.balanceRef.parent.path === `users/${input.userId}/xpLedger` ||
      input.balanceRef.path === input.ledgerRef.path ||
      input.ledgerRef.id !== `earn_${input.awardId}`) {
    throw new Error('PITANGA_EARN_REFERENCE_INVALID');
  }
  const [balance, entry] = await Promise.all([
    tx.get(input.balanceRef), tx.get(input.ledgerRef),
  ]);
  const idempotencyKey = `pitanga_earn_${input.awardId}`;
  if (entry.exists) {
    const previous = entry.data();
    if (previous?.id !== input.ledgerRef.id ||
        previous?.userId !== input.userId ||
        previous?.type !== 'earn' ||
        previous?.economy !== 'k_coin' ||
        previous?.sourceType !== input.sourceType ||
        previous?.sourceId !== input.sourceId ||
        previous?.correlationId !== input.awardId ||
        previous?.idempotencyKey !== idempotencyKey ||
        previous?.deltaKCoins !== input.amount ||
        previous?.occurredAt !== input.occurredAt) {
      throw new Error('PITANGA_EARN_IDEMPOTENCY_CONFLICT');
    }
    if (!balance.exists || balance.data()?.userId !== input.userId ||
        !Number.isSafeInteger(balance.data()?.availableKCoins) ||
        balance.data()!.availableKCoins < 0) {
      throw new Error('PITANGA_EARN_BALANCE_UNAVAILABLE');
    }
    return { balance: balance.data()!.availableKCoins, replay: true };
  }
  if (!balance.exists || balance.data()?.userId !== input.userId) {
    throw new Error('PITANGA_EARN_BALANCE_UNAVAILABLE');
  }
  const available = balance.data()?.availableKCoins;
  if (!Number.isSafeInteger(available) || available < 0 ||
      !Number.isSafeInteger(available + input.amount)) {
    throw new Error('PITANGA_EARN_BALANCE_INVALID');
  }
  tx.update(input.balanceRef, { availableKCoins: available + input.amount });
  tx.create(input.ledgerRef, {
    id: input.ledgerRef.id,
    userId: input.userId,
    type: 'earn',
    economy: 'k_coin',
    deltaKCoins: input.amount,
    sourceType: input.sourceType,
    sourceId: input.sourceId,
    correlationId: input.awardId,
    idempotencyKey,
    occurredAt: input.occurredAt,
  });
  return { balance: available + input.amount, replay: false };
};
