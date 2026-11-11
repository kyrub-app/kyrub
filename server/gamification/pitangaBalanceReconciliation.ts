import { kyrubKCoinBalance, type KyrubRewardLedgerEntry } from '../../shared/gamification.js';

/**
 * Read-only reconciliation gate before adopting a shared transactional balance.
 * This does NOT create a balance document, migrate history, or authorize spending.
 * The caller must load the complete canonical ledger for exactly one user.
 */
export const reconcilePitangaBalance = (input: {
  userId: string;
  ledgerEntries: KyrubRewardLedgerEntry[];
  projectedBalance: unknown;
  projectionUserId: unknown;
}): { userId: string; ledgerBalance: number; consistent: true } => {
  if (!/^[A-Za-z0-9_-]{1,128}$/.test(input.userId)) {
    throw new Error('PITANGA_RECONCILIATION_USER_INVALID');
  }
  if (input.ledgerEntries.some(entry => entry.userId !== input.userId)) {
    throw new Error('PITANGA_RECONCILIATION_LEDGER_OWNER_MISMATCH');
  }
  if (input.projectionUserId !== input.userId ||
      !Number.isSafeInteger(input.projectedBalance) ||
      (input.projectedBalance as number) < 0) {
    throw new Error('PITANGA_RECONCILIATION_PROJECTION_INVALID');
  }
  const ledgerBalance = kyrubKCoinBalance(input.ledgerEntries);
  if (ledgerBalance !== input.projectedBalance) {
    throw new Error('PITANGA_RECONCILIATION_BALANCE_MISMATCH');
  }
  return { userId: input.userId, ledgerBalance, consistent: true };
};
