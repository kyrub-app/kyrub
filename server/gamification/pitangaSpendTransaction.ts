import type { DocumentReference, Transaction } from 'firebase-admin/firestore';

/**
 * Isolated spending primitive. Not wired to production.
 * All earn/conversion/redemption writers must use the same reconciled balanceRef.
 */
export const applyPitangaSpendInTransaction = async (
  tx: Transaction,
  input: {
    userId: string;
    spendId: string;
    amount: number;
    sourceId: string;
    occurredAt: string;
    balanceRef: DocumentReference;
    debitRef: DocumentReference;
  },
): Promise<{ remainingPitangas: number; replay: boolean }> => {
  if (!/^[A-Za-z0-9_-]{1,128}$/.test(input.userId) ||
      !/^[A-Za-z0-9_-]{1,128}$/.test(input.spendId) ||
      !/^[A-Za-z0-9_-]{1,128}$/.test(input.sourceId) ||
      !Number.isSafeInteger(input.amount) || input.amount <= 0 ||
      !Number.isFinite(Date.parse(input.occurredAt))) {
    throw new Error('PITANGA_SPEND_INPUT_INVALID');
  }
  const userRoot = `users/${input.userId}/`;
  if (input.balanceRef.path !== `${userRoot}pitangaBalance/balance` ||
      input.debitRef.parent.path !== `users/${input.userId}/rewardLedger` ||
      input.balanceRef.parent.path === `users/${input.userId}/rewardLedger` ||
      input.balanceRef.parent.path === `users/${input.userId}/xpLedger` ||
      input.debitRef.id !== `spend_${input.spendId}` ||
      input.balanceRef.path === input.debitRef.path) {
    throw new Error('PITANGA_SPEND_REFERENCE_INVALID');
  }
  const [balance, debit] = await Promise.all([
    tx.get(input.balanceRef), tx.get(input.debitRef),
  ]);
  if (!balance.exists || balance.data()?.userId !== input.userId ||
      !Number.isSafeInteger(balance.data()?.availableKCoins) ||
      balance.data()!.availableKCoins < 0) {
    throw new Error('PITANGA_SPEND_BALANCE_UNAVAILABLE');
  }
  const available = balance.data()!.availableKCoins as number;
  const idempotencyKey = `pitanga_spend_${input.spendId}`;
  if (debit.exists) {
    const previous = debit.data();
    if (previous?.id !== input.debitRef.id ||
        previous?.userId !== input.userId ||
        previous?.type !== 'redeem' ||
        previous?.economy !== 'k_coin' ||
        previous?.sourceType !== 'reward_redemption' ||
        previous?.sourceId !== input.sourceId ||
        previous?.correlationId !== input.spendId ||
        previous?.deltaKCoins !== -input.amount ||
        previous?.idempotencyKey !== idempotencyKey ||
        previous?.occurredAt !== input.occurredAt) {
      throw new Error('PITANGA_SPEND_IDEMPOTENCY_CONFLICT');
    }
    return { remainingPitangas: available, replay: true };
  }
  if (available < input.amount) throw new Error('PITANGA_SPEND_INSUFFICIENT_BALANCE');
  const remainingPitangas = available - input.amount;
  tx.update(input.balanceRef, { availableKCoins: remainingPitangas });
  tx.create(input.debitRef, {
    id: input.debitRef.id, userId: input.userId,
    type: 'redeem', economy: 'k_coin',
    deltaKCoins: -input.amount,
    sourceType: 'reward_redemption', sourceId: input.sourceId,
    correlationId: input.spendId, idempotencyKey,
    occurredAt: input.occurredAt,
  });
  return { remainingPitangas, replay: false };
};
