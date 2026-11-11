import { createHash } from 'node:crypto';
import { assertKyrubRewardLedgerEntry, kyrubKCoinBalance, type KyrubRewardLedgerEntry } from '../../shared/gamification.js';

/**
 * Read-only migration evidence. Never writes, creates a projection or unlocks spending.
 * Completeness and the legacy-writer fence MUST be established independently by
 * the caller; this function cannot prove either from an array of entries.
 */
export const buildPitangaMigrationSnapshot = (input: {
  userId: string;
  ledgerDocuments: Array<{ id: string; data: KyrubRewardLedgerEntry }>;
  completeLedgerVerified: boolean;
  legacyWritersFenced: boolean;
  existingProjection?: { userId: unknown; availableKCoins: unknown } | null;
}): {
  userId: string;
  balance: number;
  entryCount: number;
  ledgerSha256: string;
  migrationEligible: true;
} => {
  if (!/^[A-Za-z0-9_-]{1,128}$/.test(input.userId)) {
    throw new Error('PITANGA_MIGRATION_USER_INVALID');
  }
  if (input.completeLedgerVerified !== true || input.legacyWritersFenced !== true) {
    throw new Error('PITANGA_MIGRATION_PRECONDITIONS_UNVERIFIED');
  }
  const ids = new Set<string>();
  const entries = input.ledgerDocuments.map(({ id, data }) => {
    if (!/^[A-Za-z0-9_-]{1,256}$/.test(id) || ids.has(id) ||
        data?.id !== id || data?.userId !== input.userId) {
      throw new Error('PITANGA_MIGRATION_LEDGER_SCOPE_INVALID');
    }
    ids.add(id);
    return assertKyrubRewardLedgerEntry(data);
  });
  const balance = kyrubKCoinBalance(entries);
  if (input.existingProjection != null &&
      (input.existingProjection.userId !== input.userId ||
       !Number.isSafeInteger(input.existingProjection.availableKCoins) ||
       input.existingProjection.availableKCoins !== balance)) {
    throw new Error('PITANGA_MIGRATION_PROJECTION_CONFLICT');
  }
  // Hash only canonical fields, not Firestore read order or arbitrary metadata.
  const canonical = entries.map(e => ({
    id: e.id, userId: e.userId, type: e.type, deltaKCoins: e.deltaKCoins,
    sourceType: e.sourceType, sourceId: e.sourceId, correlationId: e.correlationId,
    idempotencyKey: e.idempotencyKey, occurredAt: e.occurredAt,
    reversalOfEntryId: e.reversalOfEntryId ?? null,
  })).sort((a, b) => a.id.localeCompare(b.id));
  const ledgerSha256 = createHash('sha256').update(JSON.stringify(canonical)).digest('hex');
  return { userId: input.userId, balance, entryCount: entries.length,
    ledgerSha256, migrationEligible: true };
};
