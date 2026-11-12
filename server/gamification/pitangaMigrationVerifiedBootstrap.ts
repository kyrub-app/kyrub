import type { CollectionReference, DocumentReference, Transaction } from 'firebase-admin/firestore';
import type { KyrubRewardLedgerEntry } from '../../shared/gamification.js';
import { verifyPitangaMigrationCheckpoint, type PitangaMigrationCheckpoint } from './pitangaMigrationCheckpointVerification.js';
import { bootstrapPitangaBalanceInTransaction } from './pitangaMigrationBootstrapTransaction.js';

/**
 * Isolated transactional migration gate, not a production migration job.
 * Reads the complete per-user ledger within the SAME Firestore transaction
 * as the balance/receipt bootstrap. The caller must independently enforce
 * a real legacy-writer fence; a Firestore flag alone cannot stop old code.
 */
export const bootstrapVerifiedPitangaBalanceInTransaction = async (
  tx: Transaction,
  input: {
    checkpoint: PitangaMigrationCheckpoint;
    fenceEpoch: string;
    ledgerRef: CollectionReference;
    balanceRef: DocumentReference;
    receiptRef: DocumentReference;
    fenceRef: DocumentReference;
    legacyWritersFenced: boolean;
  },
): Promise<{ balance: number; replay: boolean }> => {
  if (input.ledgerRef.path !== `users/${input.checkpoint?.userId}/rewardLedger`) {
    throw new Error('PITANGA_BOOTSTRAP_LEDGER_REFERENCE_INVALID');
  }
  if (input.legacyWritersFenced !== true) {
    throw new Error('PITANGA_BOOTSTRAP_FENCE_UNVERIFIED');
  }
  const ledger = await tx.get(input.ledgerRef);
  verifyPitangaMigrationCheckpoint({
    checkpoint: input.checkpoint,
    ledgerDocuments: ledger.docs.map(doc => ({
      id: doc.id, data: doc.data() as KyrubRewardLedgerEntry,
    })),
    completeLedgerVerified: true,
    legacyWritersFenced: input.legacyWritersFenced,
  });
  return bootstrapPitangaBalanceInTransaction(tx, {
    ...input,
    historicalEntryIds: ledger.docs.map(doc => doc.id),
  });
};
