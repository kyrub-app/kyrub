import type { DocumentReference, Transaction } from 'firebase-admin/firestore';
import { buildPitangaHistoricalManifest, verifyPitangaHistoricalManifest } from './pitangaHistoricalManifest.js';

/**
 * Isolated, immutable manifest persistence. Caller must independently establish
 * a real writer fence and invoke this with the same historical cutover evidence.
 * Not wired to a public endpoint or production migration job.
 */
export const persistPitangaHistoricalManifestInTransaction = async (
  tx: Transaction,
  input: {
    userId: string; fenceEpoch: string; historicalEntryIds: readonly string[];
    chunkRefs: readonly DocumentReference[];
  },
): Promise<{ membershipSha256: string; entryCount: number; replay: boolean }> => {
  const manifest = buildPitangaHistoricalManifest({
    userId: input.userId, fenceEpoch: input.fenceEpoch, entryIds: input.historicalEntryIds,
  });
  if (input.chunkRefs.length !== manifest.chunks.length ||
      input.chunkRefs.some((ref, index) =>
        ref.path !== `users/${input.userId}/pitangaMigrationManifest/${input.fenceEpoch}_${String(index).padStart(6, '0')}`)) {
    throw new Error('PITANGA_MANIFEST_REFERENCE_INVALID');
  }
  // Read every chunk before any write, respecting Firestore transaction ordering.
  const snapshots = await Promise.all(input.chunkRefs.map(ref => tx.get(ref)));
  const existing = snapshots.filter(snapshot => snapshot.exists).length;
  if (existing !== 0 && existing !== snapshots.length) {
    throw new Error('PITANGA_MANIFEST_PARTIAL_STATE');
  }
  if (existing === snapshots.length) {
    const stored = {
      ...manifest,
      chunks: snapshots.map(snapshot => snapshot.data() as (typeof manifest.chunks)[number]),
    };
    verifyPitangaHistoricalManifest(stored, {
      userId: manifest.userId, fenceEpoch: manifest.fenceEpoch,
      entryCount: manifest.entryCount, membershipSha256: manifest.membershipSha256,
    });
    return { membershipSha256: manifest.membershipSha256, entryCount: manifest.entryCount, replay: true };
  }
  manifest.chunks.forEach((chunk, index) => tx.create(input.chunkRefs[index], chunk));
  return { membershipSha256: manifest.membershipSha256, entryCount: manifest.entryCount, replay: false };
};
