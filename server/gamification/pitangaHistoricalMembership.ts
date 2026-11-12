import { createHash } from 'node:crypto';

/**
 * Deterministic digest of historical Firestore document membership at cutover.
 * This does not prove that a writer fence is effective or that a ledger read
 * was complete; those must be established before committing the receipt.
 */
export const pitangaHistoricalMembershipDigest = (input: {
  userId: string;
  entryIds: readonly string[];
}): string => {
  if (!/^[A-Za-z0-9_-]{1,128}$/.test(input.userId) ||
      !Array.isArray(input.entryIds)) {
    throw new Error('PITANGA_HISTORICAL_MEMBERSHIP_INVALID');
  }
  const ids = new Set<string>();
  for (const id of input.entryIds) {
    if (typeof id !== 'string' || !/^[A-Za-z0-9_-]{1,256}$/.test(id) || ids.has(id)) {
      throw new Error('PITANGA_HISTORICAL_MEMBERSHIP_INVALID');
    }
    ids.add(id);
  }
  return createHash('sha256').update(JSON.stringify({
    userId: input.userId, entryIds: [...ids].sort(),
  })).digest('hex');
};
