import { createHash } from 'node:crypto';
import { pitangaHistoricalMembershipDigest } from './pitangaHistoricalMembership.js';

/**
 * Portable, deterministic cutover manifest. Store each chunk as a separate
 * immutable server-controlled document, never as one unbounded Firestore field.
 * This is a pure builder/verifier: it does not persist or authorize a cutover.
 */
export const PITANGA_MANIFEST_CHUNK_SIZE = 100;

export type PitangaHistoricalManifest = {
  userId: string;
  fenceEpoch: string;
  entryCount: number;
  membershipSha256: string;
  chunks: Array<{ index: number; entryIds: string[]; sha256: string }>;
};

const chunkDigest = (input: { userId: string; fenceEpoch: string; index: number; entryIds: string[] }): string =>
  createHash('sha256').update(JSON.stringify(input)).digest('hex');

export const buildPitangaHistoricalManifest = (input: {
  userId: string; fenceEpoch: string; entryIds: readonly string[];
}): PitangaHistoricalManifest => {
  if (typeof input.fenceEpoch !== 'string' || !/^[A-Za-z0-9_-]{1,128}$/.test(input.fenceEpoch)) {
    throw new Error('PITANGA_MANIFEST_EPOCH_INVALID');
  }
  const membershipSha256 = pitangaHistoricalMembershipDigest(input);
  const ids = [...input.entryIds].sort();
  const chunks: PitangaHistoricalManifest['chunks'] = [];
  for (let offset = 0; offset < ids.length; offset += PITANGA_MANIFEST_CHUNK_SIZE) {
    const entryIds = ids.slice(offset, offset + PITANGA_MANIFEST_CHUNK_SIZE);
    const index = chunks.length;
    chunks.push({
      index, entryIds,
      sha256: chunkDigest({ userId: input.userId, fenceEpoch: input.fenceEpoch, index, entryIds }),
    });
  }
  return { userId: input.userId, fenceEpoch: input.fenceEpoch,
    entryCount: ids.length, membershipSha256, chunks };
};

export const verifyPitangaHistoricalManifest = (manifest: PitangaHistoricalManifest, expected: {
  userId: string; fenceEpoch: string; entryCount: number; membershipSha256: string;
}): string[] => {
  if (!manifest || manifest.userId !== expected.userId ||
      manifest.fenceEpoch !== expected.fenceEpoch ||
      manifest.entryCount !== expected.entryCount ||
      manifest.membershipSha256 !== expected.membershipSha256 ||
      !Array.isArray(manifest.chunks) ||
      !Number.isSafeInteger(manifest.entryCount) || manifest.entryCount < 0 ||
      manifest.chunks.length !== Math.ceil(manifest.entryCount / PITANGA_MANIFEST_CHUNK_SIZE)) {
    throw new Error('PITANGA_MANIFEST_MISMATCH');
  }
  const ids: string[] = [];
  for (let index = 0; index < manifest.chunks.length; index++) {
    const chunk = manifest.chunks[index];
    if (!chunk || chunk.index !== index || !Array.isArray(chunk.entryIds) ||
        chunk.entryIds.length !== Math.min(PITANGA_MANIFEST_CHUNK_SIZE, manifest.entryCount - ids.length) ||
        chunk.sha256 !== chunkDigest({
          userId: manifest.userId, fenceEpoch: manifest.fenceEpoch, index, entryIds: chunk.entryIds,
        })) {
      throw new Error('PITANGA_MANIFEST_CHUNK_INVALID');
    }
    ids.push(...chunk.entryIds);
  }
  if (pitangaHistoricalMembershipDigest({ userId: manifest.userId, entryIds: ids }) !== expected.membershipSha256 ||
      ids.some((id, index) => index > 0 && ids[index - 1] >= id)) {
    throw new Error('PITANGA_MANIFEST_MEMBERSHIP_INVALID');
  }
  return ids;
};
