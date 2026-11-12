import type { KyrubRewardLedgerEntry } from '../../shared/gamification.js';
import { buildPitangaMigrationSnapshot } from './pitangaMigrationSnapshot.js';

export interface PitangaMigrationCheckpoint {
  userId: string;
  balance: number;
  entryCount: number;
  ledgerSha256: string;
}

/**
 * Recheck a proposed historical checkpoint against a fresh complete ledger read.
 * This is read-only and NOT an atomic cutover: writers must remain externally
 * fenced across both reads and the eventual migration transaction.
 */
export const verifyPitangaMigrationCheckpoint = (input: {
  checkpoint: PitangaMigrationCheckpoint;
  ledgerDocuments: Array<{ id: string; data: KyrubRewardLedgerEntry }>;
  completeLedgerVerified: boolean;
  legacyWritersFenced: boolean;
  existingProjection?: { userId: unknown; availableKCoins: unknown } | null;
}): { verified: true; checkpoint: PitangaMigrationCheckpoint } => {
  const checkpoint = input.checkpoint;
  if (!checkpoint || !/^[A-Za-z0-9_-]{1,128}$/.test(checkpoint.userId) ||
      !Number.isSafeInteger(checkpoint.balance) || checkpoint.balance < 0 ||
      !Number.isSafeInteger(checkpoint.entryCount) || checkpoint.entryCount < 0 ||
      !/^[a-f0-9]{64}$/.test(checkpoint.ledgerSha256)) {
    throw new Error('PITANGA_CHECKPOINT_INVALID');
  }
  const current = buildPitangaMigrationSnapshot({
    userId: checkpoint.userId,
    ledgerDocuments: input.ledgerDocuments,
    completeLedgerVerified: input.completeLedgerVerified,
    legacyWritersFenced: input.legacyWritersFenced,
    existingProjection: input.existingProjection,
  });
  if (current.balance !== checkpoint.balance ||
      current.entryCount !== checkpoint.entryCount ||
      current.ledgerSha256 !== checkpoint.ledgerSha256) {
    throw new Error('PITANGA_CHECKPOINT_STALE');
  }
  return { verified: true, checkpoint: {
    userId: current.userId, balance: current.balance,
    entryCount: current.entryCount, ledgerSha256: current.ledgerSha256,
  } };
};
