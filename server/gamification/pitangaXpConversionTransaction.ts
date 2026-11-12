import type { DocumentReference, Transaction } from 'firebase-admin/firestore';
import { PITANGAS_PER_XP, planVoluntaryPitangaXpConversion } from '../../shared/pitangaXpConversion.js';

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
  if (!Number.isSafeInteger(input.requestedXp * PITANGAS_PER_XP)) throw new Error('XP_CONVERSION_OVERFLOW');
  // Defense in depth: reject cross-user and cross-economy references even when
  // a trusted server adapter supplies them. The balance and receipt collection
  // names are intentionally not assumed until the canonical writer is verified.
  const userRoot = `users/${input.userId}/`;
  const references = [input.balanceRef, input.debitRef, input.xpRef, input.receiptRef];
  if (references.some(ref => !ref.path.startsWith(userRoot)) ||
      input.balanceRef.path !== `${userRoot}pitangaBalance/balance` ||
      input.debitRef.parent.path !== `users/${input.userId}/rewardLedger` ||
      input.xpRef.parent.path !== `users/${input.userId}/xpLedger` ||
      input.receiptRef.parent.path !== `users/${input.userId}/pitangaXpConversions` ||
      input.receiptRef.id !== input.requestId ||
      input.debitRef.id !== `conversion_${input.requestId}` ||
      input.xpRef.id !== `conversion_${input.requestId}` ||
      [input.balanceRef, input.receiptRef].some(ref =>
        ref.parent.path === `users/${input.userId}/rewardLedger` ||
        ref.parent.path === `users/${input.userId}/xpLedger`) ||
      new Set(references.map(ref => ref.path)).size !== references.length) {
    throw new Error('CONVERSION_REFERENCE_SCOPE_INVALID');
  }
  // Never accept client-supplied Firestore paths: the trusted caller resolves these.
  // All transaction reads must precede writes.
  const [receipt, balance, debit, xp] = await Promise.all([
    tx.get(input.receiptRef), tx.get(input.balanceRef),
    tx.get(input.debitRef), tx.get(input.xpRef),
  ]);
  if (receipt.exists) {
    // A historical receipt cannot authorize replay if the shared spending
    // authority disappeared or was reassigned to another user.
    if (!balance.exists || balance.data()?.userId !== input.userId ||
        typeof balance.data()?.migrationEpoch !== 'string' ||
      !/^[A-Za-z0-9_-]{1,128}$/.test(balance.data()!.migrationEpoch) ||
      !Number.isSafeInteger(balance.data()?.availableKCoins) ||
        balance.data()!.availableKCoins < 0) {
      throw new Error('CONVERSION_REPLAY_BALANCE_UNAVAILABLE');
    }
    const previous = receipt.data();
    if (previous?.userId !== input.userId ||
        previous?.requestId !== input.requestId ||
        previous?.requestedXp !== input.requestedXp ||
        previous?.status !== 'committed') throw new Error('CONVERSION_IDEMPOTENCY_CONFLICT');
    if (!Number.isSafeInteger(previous.availablePitangasBefore) ||
        previous.availablePitangasBefore < 0) {
      throw new Error('CONVERSION_RECEIPT_INCONSISTENT');
    }
    if (!debit.exists || !xp.exists) throw new Error('CONVERSION_RECEIPT_INCONSISTENT');
    if (!Number.isFinite(Date.parse(previous.occurredAt))) throw new Error('CONVERSION_RECEIPT_INCONSISTENT');
    const plan = planVoluntaryPitangaXpConversion(
      previous.availablePitangasBefore, input.requestedXp,
    );
    if (debit.data()?.userId !== input.userId ||
        debit.data()?.correlationId !== input.requestId ||
        debit.data()?.occurredAt !== previous.occurredAt ||
        debit.data()?.id !== input.debitRef.id ||
        debit.data()?.idempotencyKey !== `pitanga_xp_${input.requestId}` ||
        debit.data()?.type !== 'redeem' ||
        debit.data()?.economy !== 'k_coin' ||
        debit.data()?.sourceType !== 'conversion' ||
        debit.data()?.sourceId !== input.requestId ||
        debit.data()?.deltaKCoins !== -plan.pitangasToDebit ||
        xp.data()?.userId !== input.userId ||
        xp.data()?.correlationId !== input.requestId ||
        xp.data()?.occurredAt !== previous.occurredAt ||
        xp.data()?.id !== input.xpRef.id ||
        xp.data()?.idempotencyKey !== `pitanga_xp_${input.requestId}` ||
        xp.data()?.sourceType !== 'conversion' ||
        xp.data()?.economy !== 'kyrub_xp' ||
        xp.data()?.sourceId !== input.requestId ||
        xp.data()?.deltaXp !== plan.xpToCredit) throw new Error('CONVERSION_LEDGER_INCONSISTENT');
    return { xpCredited: plan.xpToCredit, pitangasDebited: plan.pitangasToDebit,
      remainingPitangas: balance.data()!.availableKCoins as number, replay: true };
  }
  if (debit.exists || xp.exists) throw new Error('CONVERSION_PARTIAL_STATE');
  if (!balance.exists || balance.data()?.userId !== input.userId ||
      typeof balance.data()?.migrationEpoch !== 'string' ||
      !/^[A-Za-z0-9_-]{1,128}$/.test(balance.data()!.migrationEpoch)) {
    throw new Error('CONVERSION_BALANCE_NOT_INITIALIZED');
  }
  const available = balance.data()?.availableKCoins;
  const plan = planVoluntaryPitangaXpConversion(available, input.requestedXp);
  const idempotencyKey = `pitanga_xp_${input.requestId}`;
  tx.update(input.balanceRef, { availableKCoins: plan.remainingPitangas });
  tx.create(input.debitRef, {
    id: input.debitRef.id, userId: input.userId, type: 'redeem', economy: 'k_coin',
    deltaKCoins: -plan.pitangasToDebit, sourceType: 'conversion',
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
