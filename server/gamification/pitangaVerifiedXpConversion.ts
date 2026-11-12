import type { DocumentReference, Transaction } from 'firebase-admin/firestore';
import { applyPitangaXpConversionInTransaction } from './pitangaXpConversionTransaction.js';

/**
 * Isolated fail-closed conversion gate. Not wired to any public endpoint.
 * A fence document is not proof that every deployed legacy writer observes it;
 * deployment still requires independent writer coverage and cutover approval.
 */
export const applyVerifiedPitangaXpConversionInTransaction = async (
  tx: Transaction,
  input: {
    userId: string;
    requestId: string;
    requestedXp: number;
    occurredAt: string;
    balanceRef: DocumentReference;
    receiptRef: DocumentReference;
    debitRef: DocumentReference;
    xpRef: DocumentReference;
    migrationReceiptRef: DocumentReference;
    fenceRef: DocumentReference;
  },
): Promise<{ xpCredited: number; pitangasDebited: number; remainingPitangas: number; replay: boolean }> => {
  const uid = input.userId;
  if (!/^[A-Za-z0-9_-]{1,128}$/.test(uid) ||
      input.balanceRef.path !== `users/${uid}/pitangaBalance/balance` ||
      input.receiptRef.path !== `users/${uid}/pitangaXpConversions/${input.requestId}` ||
      input.debitRef.path !== `users/${uid}/rewardLedger/conversion_${input.requestId}` ||
      input.xpRef.path !== `users/${uid}/xpLedger/conversion_${input.requestId}` ||
      input.migrationReceiptRef.path !== `users/${uid}/pitangaMigration/receipt` ||
      input.fenceRef.path !== 'systemControl/pitangaLegacyWriterFence') {
    throw new Error('CONVERSION_MIGRATION_REFERENCE_INVALID');
  }
  const [balance, receipt, fence] = await Promise.all([
    tx.get(input.balanceRef), tx.get(input.migrationReceiptRef), tx.get(input.fenceRef),
  ]);
  const b = balance.data();
  const r = receipt.data();
  const f = fence.data();
  if (!balance.exists || !receipt.exists || !fence.exists ||
      b?.userId !== uid || r?.userId !== uid ||
      typeof b?.migrationEpoch !== 'string' ||
      !/^[A-Za-z0-9_-]{1,128}$/.test(b.migrationEpoch) ||
      !Number.isSafeInteger(b?.availableKCoins) || b.availableKCoins < 0 ||
      r?.fenceEpoch !== b.migrationEpoch ||
      !Number.isSafeInteger(r?.balance) || r.balance < 0 ||
      !Number.isSafeInteger(r?.entryCount) || r.entryCount < 0 ||
      typeof r?.ledgerSha256 !== 'string' ||
      !/^[a-f0-9]{64}$/.test(r.ledgerSha256) ||
      typeof r?.historicalMembershipSha256 !== 'string' ||
      !/^[a-f0-9]{64}$/.test(r.historicalMembershipSha256) ||
      f?.epoch !== b.migrationEpoch || f?.status !== 'fenced' ||
      f?.writersVerified !== true) {
    throw new Error('CONVERSION_MIGRATION_UNVERIFIED');
  }
  return applyPitangaXpConversionInTransaction(tx, input);
};
