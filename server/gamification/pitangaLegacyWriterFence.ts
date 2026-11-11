import type { DocumentReference, Transaction } from 'firebase-admin/firestore';

/**
 * Shared guard for legacy global Pitanga writers during migration.
 * Every production writer must call this inside its Firestore transaction,
 * BEFORE any mutation. Installing this helper alone does not fence writers.
 *
 * Missing control document means normal legacy operation, preserving behavior
 * until an explicitly approved migration fence is activated.
 */
export const assertLegacyPitangaWriterAllowedInTransaction = async (
  tx: Transaction,
  input: {
    fenceRef: DocumentReference;
    expectedEpoch?: string;
  },
): Promise<void> => {
  if (input.fenceRef.path !== 'systemControl/pitangaLegacyWriterFence') {
    throw new Error('PITANGA_LEGACY_FENCE_REFERENCE_INVALID');
  }
  const snapshot = await tx.get(input.fenceRef);
  if (!snapshot.exists) return;
  const fence = snapshot.data();
  if (fence?.status === 'fenced' || fence?.status === 'fencing') {
    throw new Error('PITANGA_LEGACY_WRITER_FENCED');
  }
  if (fence?.status !== 'open' ||
      (input.expectedEpoch !== undefined && fence?.epoch !== input.expectedEpoch)) {
    throw new Error('PITANGA_LEGACY_FENCE_INVALID');
  }
};
