import type { DocumentReference, Transaction } from 'firebase-admin/firestore';
import type { PitangaMigrationCheckpoint } from './pitangaMigrationCheckpointVerification.js';
import { pitangaHistoricalMembershipDigest } from './pitangaHistoricalMembership.js';

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
    historicalEntryIds: readonly string[];
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
  if (!Array.isArray(input.historicalEntryIds) ||
      input.historicalEntryIds.length !== checkpoint.entryCount) {
    throw new Error('PITANGA_BOOTSTRAP_HISTORICAL_MEMBERSHIP_INVALID');
  }
  const historicalMembershipSha256 = pitangaHistoricalMembershipDigest({
    userId: uid, entryIds: input.historicalEntryIds,
  });
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
    // The migration receipt is immutable; the live projection may legitimately
    // change after migration. Never overwrite it or recreate the original grant.
    if (b?.userId !== uid || b?.migrationEpoch !== fenceEpoch ||
        !Number.isSafeInteger(b?.availableKCoins) || b.availableKCoins < 0 ||
        r?.userId !== uid || r?.balance !== checkpoint.balance ||
        r?.entryCount !== checkpoint.entryCount ||
        r?.ledgerSha256 !== checkpoint.ledgerSha256 ||
        r?.historicalMembershipSha256 !== historicalMembershipSha256 ||
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
    historicalMembershipSha256,
    fenceEpoch,
  });
  return { balance: checkpoint.balance, replay: false };
};
