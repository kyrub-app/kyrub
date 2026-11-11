import type { DocumentReference, Transaction } from 'firebase-admin/firestore';
import type { PitangaMigrationCheckpoint } from './pitangaMigrationCheckpointVerification.js';

/**
 * Isolated bootstrap primitive; not wired to any API or migration job.
 * A fence document alone cannot block legacy writers that do not read it.
 * Invoke only after independently verifying every writer is fenced and
 * rechecking the complete historical ledger at that fence epoch.
 */
export const bootstrapPitangaBalanceInTransaction = async (
  tx: Transaction,
  input: {
    checkpoint: PitangaMigrationCheckpoint;
    fenceEpoch: string;
    balanceRef: DocumentReference;
    receiptRef: DocumentReference;
    fenceRef: DocumentReference;
  },
): Promise<{ balance: number; replay: boolean }> => {
  const { checkpoint, fenceEpoch } = input;
  const uid = checkpoint?.userId;
  if (typeof uid !== 'string' || !/^[A-Za-z0-9_-]{1,128}$/.test(uid) ||
      !Number.isSafeInteger(checkpoint.balance) || checkpoint.balance < 0 ||
      !Number.isSafeInteger(checkpoint.entryCount) || checkpoint.entryCount < 0 ||
      !/^[a-f0-9]{64}$/.test(checkpoint.ledgerSha256) ||
      typeof fenceEpoch !== 'string' || !/^[A-Za-z0-9_-]{1,128}$/.test(fenceEpoch)) {
    throw new Error('PITANGA_BOOTSTRAP_INPUT_INVALID');
  }
  const root = `users/${uid}`;
  if (input.balanceRef.path !== `${root}/pitangaBalance/balance` ||
      input.receiptRef.path !== `${root}/pitangaMigration/receipt` ||
      input.fenceRef.path !== 'systemControl/pitangaLegacyWriterFence') {
    throw new Error('PITANGA_BOOTSTRAP_REFERENCE_INVALID');
  }
  const [fence, balance, receipt] = await Promise.all([
    tx.get(input.fenceRef), tx.get(input.balanceRef), tx.get(input.receiptRef),
  ]);
  const f = fence.data();
  if (!fence.exists || f?.status !== 'fenced' || f?.epoch !== fenceEpoch ||
      f?.writersVerified !== true) {
    throw new Error('PITANGA_BOOTSTRAP_FENCE_UNVERIFIED');
  }
  if (balance.exists || receipt.exists) {
    if (!balance.exists || !receipt.exists) {
      throw new Error('PITANGA_BOOTSTRAP_PARTIAL_STATE');
    }
    const b = balance.data();
    const r = receipt.data();
    if (b?.userId !== uid || b?.migrationEpoch !== fenceEpoch ||
        b?.availableKCoins !== checkpoint.balance ||
        r?.userId !== uid || r?.balance !== checkpoint.balance ||
        r?.entryCount !== checkpoint.entryCount ||
        r?.ledgerSha256 !== checkpoint.ledgerSha256 ||
        r?.fenceEpoch !== fenceEpoch) {
      throw new Error('PITANGA_BOOTSTRAP_CONFLICT');
    }
    return { balance: checkpoint.balance, replay: true };
  }
  tx.create(input.balanceRef, {
    userId: uid, availableKCoins: checkpoint.balance,
    migrationEpoch: fenceEpoch,
  });
  tx.create(input.receiptRef, {
    userId: uid, balance: checkpoint.balance,
    entryCount: checkpoint.entryCount,
    ledgerSha256: checkpoint.ledgerSha256,
    fenceEpoch,
  });
  return { balance: checkpoint.balance, replay: false };
};
