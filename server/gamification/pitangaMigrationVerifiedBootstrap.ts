import type { CollectionReference, DocumentReference, Transaction } from 'firebase-admin/firestore';
import type { KyrubRewardLedgerEntry } from '../../shared/gamification.js';
import { verifyPitangaMigrationCheckpoint, type PitangaMigrationCheckpoint } from './pitangaMigrationCheckpointVerification.js';
import { bootstrapPitangaBalanceInTransaction } from './pitangaMigrationBootstrapTransaction.js';
import { buildPitangaHistoricalManifest, verifyPitangaHistoricalManifest } from './pitangaHistoricalManifest.js';

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
    manifestChunkRefs?: readonly DocumentReference[];
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
  const historicalEntryIds = ledger.docs.map(doc => doc.id);
  if (!input.manifestChunkRefs) throw new Error('PITANGA_BOOTSTRAP_MANIFEST_REQUIRED');
  const manifest = buildPitangaHistoricalManifest({
    userId: input.checkpoint.userId, fenceEpoch: input.fenceEpoch, entryIds: historicalEntryIds,
  });
  if (manifest.chunks.length > 400) throw new Error('PITANGA_MANIFEST_TRANSACTION_TOO_LARGE');
  if (input.manifestChunkRefs.length !== manifest.chunks.length ||
      input.manifestChunkRefs.some((ref, index) =>
        ref.path !== 'users/' + input.checkpoint.userId + '/pitangaMigrationManifest/' +
          input.fenceEpoch + '_' + String(index).padStart(6, '0'))) {
    throw new Error('PITANGA_MANIFEST_REFERENCE_INVALID');
  }
  // Read all chunk documents before bootstrap performs any writes.
  const snapshots = await Promise.all(input.manifestChunkRefs.map(ref => tx.get(ref)));
  const existing = snapshots.filter(snapshot => snapshot.exists).length;
  if (existing !== 0 && existing !== snapshots.length) throw new Error('PITANGA_MANIFEST_PARTIAL_STATE');
  if (existing === snapshots.length && snapshots.length > 0) {
    verifyPitangaHistoricalManifest({
      ...manifest, chunks: snapshots.map(snapshot => snapshot.data() as (typeof manifest.chunks)[number]),
    }, {
      userId: manifest.userId, fenceEpoch: manifest.fenceEpoch,
      entryCount: manifest.entryCount, membershipSha256: manifest.membershipSha256,
    });
  }
  const result = await bootstrapPitangaBalanceInTransaction(tx, { ...input, historicalEntryIds });
  if (manifest.chunks.length > 0 && result.replay !== (existing === snapshots.length)) {
    throw new Error('PITANGA_BOOTSTRAP_MANIFEST_RECEIPT_CONFLICT');
  }
  if (!result.replay) {
    manifest.chunks.forEach((chunk, index) => tx.create(input.manifestChunkRefs![index], chunk));
  }
  return result;
};
