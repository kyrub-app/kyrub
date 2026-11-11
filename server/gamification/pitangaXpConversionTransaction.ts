import type { DocumentReference, Transaction } from 'firebase-admin/firestore';
import { planVoluntaryPitangaXpConversion } from '../../shared/pitangaXpConversion.js';

/**
 * Atomic conversion primitive. This is NOT a public endpoint.
 * References MUST be resolved by trusted server code to the verified canonical
 * reward balance/ledger and the existing user XP ledger before calling.
 * Do not invoke until that integration and emulator security tests exist.
 */
export const applyPitangaXpConversionInTransaction = async (
  tx: Transaction,
  input: {
    userId: string;
    requestId: string;
    requestedXp: number;
    occurredAt: string;
    balanceRef: DocumentReference;
    debitRef: DocumentReference;
    xpRef: DocumentReference;
    receiptRef: DocumentReference;
  },
): Promise<{ xpCredited: number; pitangasDebited: number; remainingPitangas: number; replay: boolean }> => {
  if (!/^[A-Za-z0-9_-]{1,128}$/.test(input.userId)) throw new Error('CONVERSION_USER_INVALID');
  if (!/^[A-Za-z0-9_-]{1,128}$/.test(input.requestId)) throw new Error('CONVERSION_REQUEST_INVALID');
  if (!Number.isFinite(Date.parse(input.occurredAt))) throw new Error('CONVERSION_DATE_INVALID');
  if (!Number.isSafeInteger(input.requestedXp) || input.requestedXp < 1) {
    throw new Error('XP_CONVERSION_AMOUNT_INVALID');
  }
  if (!Number.isSafeInteger(input.requestedXp * 100)) throw new Error('XP_CONVERSION_OVERFLOW');
  // Never accept client-supplied Firestore paths: the trusted caller resolves these.
  // All transaction reads must precede writes.
  const [receipt, balance, debit, xp] = await Promise.all([
    tx.get(input.receiptRef), tx.get(input.balanceRef),
    tx.get(input.debitRef), tx.get(input.xpRef),
  ]);
  if (receipt.exists) {
    const previous = receipt.data();
    if (previous?.userId !== input.userId ||
        previous?.requestId !== input.requestId ||
        previous?.requestedXp !== input.requestedXp ||
        previous?.status !== 'committed' ||
        previous?.occurredAt !== input.occurredAt) throw new Error('CONVERSION_IDEMPOTENCY_CONFLICT');
    if (!debit.exists || !xp.exists) throw new Error('CONVERSION_RECEIPT_INCONSISTENT');
    const plan = planVoluntaryPitangaXpConversion(
      previous.availablePitangasBefore, input.requestedXp,
    );
    if (debit.data()?.userId !== input.userId ||
        debit.data()?.correlationId !== input.requestId ||
        debit.data()?.occurredAt !== input.occurredAt ||
        debit.data()?.id !== input.debitRef.id ||
        debit.data()?.idempotencyKey !== `pitanga_xp_${input.requestId}` ||
        debit.data()?.type !== 'redeem' ||
        debit.data()?.sourceType !== 'reward_redemption' ||
        debit.data()?.sourceId !== input.requestId ||
        debit.data()?.deltaKCoins !== -plan.pitangasToDebit ||
        xp.data()?.userId !== input.userId ||
        xp.data()?.correlationId !== input.requestId ||
        xp.data()?.occurredAt !== input.occurredAt ||
        xp.data()?.id !== input.xpRef.id ||
        xp.data()?.idempotencyKey !== `pitanga_xp_${input.requestId}` ||
        xp.data()?.sourceType !== 'conversion' ||
        xp.data()?.sourceId !== input.requestId ||
        xp.data()?.deltaXp !== plan.xpToCredit) throw new Error('CONVERSION_LEDGER_INCONSISTENT');
    return { xpCredited: plan.xpToCredit, pitangasDebited: plan.pitangasToDebit,
      remainingPitangas: plan.remainingPitangas, replay: true };
  }
  if (debit.exists || xp.exists) throw new Error('CONVERSION_PARTIAL_STATE');
  if (!balance.exists || balance.data()?.userId !== input.userId) {
    throw new Error('CONVERSION_BALANCE_NOT_INITIALIZED');
  }
  const available = balance.data()?.availableKCoins;
  const plan = planVoluntaryPitangaXpConversion(available, input.requestedXp);
  const idempotencyKey = `pitanga_xp_${input.requestId}`;
  tx.update(input.balanceRef, { availableKCoins: plan.remainingPitangas });
  tx.create(input.debitRef, {
    id: input.debitRef.id, userId: input.userId, type: 'redeem',
    deltaKCoins: -plan.pitangasToDebit, sourceType: 'reward_redemption',
    sourceId: input.requestId, correlationId: input.requestId,
    idempotencyKey, occurredAt: input.occurredAt,
  });
  tx.create(input.xpRef, {
    id: input.xpRef.id, userId: input.userId, sourceType: 'conversion',
    sourceId: input.requestId, deltaXp: plan.xpToCredit,
    correlationId: input.requestId, idempotencyKey,
    occurredAt: input.occurredAt, economy: 'kyrub_xp',
  });
  tx.create(input.receiptRef, {
    userId: input.userId, requestId: input.requestId,
    requestedXp: input.requestedXp, availablePitangasBefore: available,
    status: 'committed', occurredAt: input.occurredAt,
  });
  return { xpCredited: plan.xpToCredit, pitangasDebited: plan.pitangasToDebit,
    remainingPitangas: plan.remainingPitangas, replay: false };
};
