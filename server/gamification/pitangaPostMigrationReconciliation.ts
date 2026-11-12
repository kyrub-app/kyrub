import type { KyrubRewardLedgerEntry } from '../../shared/gamification.js';
import { kyrubKCoinBalance } from '../../shared/gamification.js';
import { buildPitangaMigrationSnapshot } from './pitangaMigrationSnapshot.js';
import { pitangaHistoricalMembershipDigest } from './pitangaHistoricalMembership.js';
import { verifyPitangaHistoricalManifest, type PitangaHistoricalManifest } from './pitangaHistoricalManifest.js';
import type { PitangaMigrationCheckpoint } from './pitangaMigrationCheckpointVerification.js';

/**
 * Read-only reconciliation of an immutable migration checkpoint with subsequent
 * ledger movements. Historical membership must be supplied from independently
 * verified cutover evidence, never inferred from client timestamps.
 * Not wired to a production route or migration job.
 */
export const reconcilePostMigrationPitangas = (input: {
  checkpoint: PitangaMigrationCheckpoint;
  historicalEntryIds: readonly string[];
  /** Optional independently retrieved chunk documents, checked against receipt. */
  historicalManifest?: PitangaHistoricalManifest;
  /** Trusted immutable migration receipt, read from the canonical server path. */
  migrationReceipt: {
    userId: unknown; balance: unknown; entryCount: unknown;
    ledgerSha256: unknown; historicalMembershipSha256: unknown; fenceEpoch: unknown;
  };
  ledgerDocuments: Array<{ id: string; data: KyrubRewardLedgerEntry }>;
  currentBalance: { userId: unknown; availableKCoins: unknown; migrationEpoch: unknown };
  fenceEpoch: string;
  completeLedgerVerified: boolean;
  legacyWritersFenced: boolean;
}): { verified: true; historicalBalance: number; postMigrationDelta: number; currentBalance: number } => {
  const { checkpoint, historicalEntryIds, ledgerDocuments, currentBalance, fenceEpoch } = input;
  if (input.completeLedgerVerified !== true || input.legacyWritersFenced !== true ||
      !/^[A-Za-z0-9_-]{1,128}$/.test(checkpoint?.userId ?? '') ||
      !/^[A-Za-z0-9_-]{1,128}$/.test(fenceEpoch) ||
      currentBalance?.userId !== checkpoint.userId ||
      currentBalance?.migrationEpoch !== fenceEpoch ||
      !Number.isSafeInteger(currentBalance?.availableKCoins) ||
      (currentBalance.availableKCoins as number) < 0) {
    throw new Error('PITANGA_RECONCILIATION_PRECONDITIONS_INVALID');
  }
  const receipt = input.migrationReceipt;
  if (receipt?.userId !== checkpoint.userId ||
      receipt?.balance !== checkpoint.balance ||
      receipt?.entryCount !== checkpoint.entryCount ||
      receipt?.ledgerSha256 !== checkpoint.ledgerSha256 ||
      receipt?.fenceEpoch !== fenceEpoch) {
    throw new Error('PITANGA_RECONCILIATION_RECEIPT_MISMATCH');
  }
  if (input.historicalManifest) {
    const restoredIds = verifyPitangaHistoricalManifest(input.historicalManifest, {
      userId: checkpoint.userId, fenceEpoch,
      entryCount: checkpoint.entryCount,
      membershipSha256: receipt.historicalMembershipSha256 as string,
    });
    if (pitangaHistoricalMembershipDigest({ userId: checkpoint.userId, entryIds: restoredIds }) !==
        pitangaHistoricalMembershipDigest({ userId: checkpoint.userId, entryIds: historicalEntryIds })) {
      throw new Error('PITANGA_RECONCILIATION_MANIFEST_MEMBERSHIP_MISMATCH');
    }
  }
  const ids = new Set(historicalEntryIds);
  if (ids.size !== historicalEntryIds.length || ids.size !== checkpoint.entryCount ||
      historicalEntryIds.some(id => !/^[A-Za-z0-9_-]{1,256}$/.test(id))) {
    throw new Error('PITANGA_RECONCILIATION_HISTORICAL_MEMBERSHIP_INVALID');
  }
  if (typeof receipt.historicalMembershipSha256 !== 'string' ||
      !/^[a-f0-9]{64}$/.test(receipt.historicalMembershipSha256) ||
      pitangaHistoricalMembershipDigest({
        userId: checkpoint.userId, entryIds: historicalEntryIds,
      }) !== receipt.historicalMembershipSha256) {
    throw new Error('PITANGA_RECONCILIATION_MEMBERSHIP_DIGEST_MISMATCH');
  }
  const documents = new Map<string, { id: string; data: KyrubRewardLedgerEntry }>();
  for (const doc of ledgerDocuments) {
    if (documents.has(doc.id) || doc.data?.id !== doc.id ||
        doc.data?.userId !== checkpoint.userId) {
      throw new Error('PITANGA_RECONCILIATION_LEDGER_SCOPE_INVALID');
    }
    documents.set(doc.id, doc);
  }
  const historical = historicalEntryIds.map(id => documents.get(id));
  if (historical.some(doc => !doc)) {
    throw new Error('PITANGA_RECONCILIATION_HISTORICAL_ENTRY_MISSING');
  }
  const snapshot = buildPitangaMigrationSnapshot({
    userId: checkpoint.userId,
    ledgerDocuments: historical as Array<{ id: string; data: KyrubRewardLedgerEntry }>,
    completeLedgerVerified: true, legacyWritersFenced: true,
  });
  if (snapshot.balance !== checkpoint.balance ||
      snapshot.entryCount !== checkpoint.entryCount ||
      snapshot.ledgerSha256 !== checkpoint.ledgerSha256) {
    throw new Error('PITANGA_RECONCILIATION_HISTORICAL_CHANGED');
  }
  const ledgerBalance = kyrubKCoinBalance(ledgerDocuments.map(doc => doc.data));
  if (ledgerBalance !== currentBalance.availableKCoins) {
    throw new Error('PITANGA_RECONCILIATION_BALANCE_MISMATCH');
  }
  return {
    verified: true, historicalBalance: checkpoint.balance,
    postMigrationDelta: ledgerBalance - checkpoint.balance,
    currentBalance: ledgerBalance,
  };
};
