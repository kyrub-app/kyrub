import type { Firestore } from 'firebase-admin/firestore';
import type { KyrubRewardLedgerEntry } from '../../shared/gamification.js';
import { assertKyrubRewardLedgerEntry, kyrubKCoinBalance } from '../../shared/gamification.js';
import { reconcilePitangaBalance } from './pitangaBalanceReconciliation.js';

/**
 * Read-only inspection of historical reward ledger versus the proposed shared
 * balance projection. Never creates a balance, migrates history or unlocks spending.
 */
export const inspectPitangaBalanceAuthority = async (
  db: Pick<Firestore, 'collection' | 'doc'>,
  userId: string,
): Promise<{
  status: 'projection_missing' | 'consistent' | 'inconsistent';
  ledgerBalance: number;
  projectedBalance: number | null;
  entryCount: number;
  reason?: string;
}> => {
  if (!/^[A-Za-z0-9_-]{1,128}$/.test(userId)) {
    throw new Error('PITANGA_INSPECTION_USER_INVALID');
  }
  const [ledger, projection] = await Promise.all([
    db.collection(`users/${userId}/rewardLedger`).get(),
    db.doc(`users/${userId}/pitangaBalance/balance`).get(),
  ]);
  const entries = ledger.docs.map(doc => {
    const entry = doc.data() as KyrubRewardLedgerEntry;
    if (entry.id !== doc.id || entry.userId !== userId) {
      throw new Error('PITANGA_INSPECTION_LEDGER_SCOPE_INVALID');
    }
    return assertKyrubRewardLedgerEntry(entry);
  });
  const ledgerBalance = kyrubKCoinBalance(entries);
  if (!projection.exists) {
    return { status: 'projection_missing', ledgerBalance,
      projectedBalance: null, entryCount: entries.length };
  }
  const data = projection.data();
  try {
    reconcilePitangaBalance({
      userId, ledgerEntries: entries,
      projectedBalance: data?.availableKCoins,
      projectionUserId: data?.userId,
    });
    return { status: 'consistent', ledgerBalance,
      projectedBalance: data!.availableKCoins as number, entryCount: entries.length };
  } catch (error) {
    return { status: 'inconsistent', ledgerBalance,
      projectedBalance: typeof data?.availableKCoins === 'number'
        && Number.isSafeInteger(data.availableKCoins) ? data.availableKCoins : null,
      entryCount: entries.length,
      reason: error instanceof Error ? error.message : 'UNKNOWN' };
  }
};
