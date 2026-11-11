import assert from 'node:assert/strict';
import test from 'node:test';
import { buildPitangaMigrationSnapshot } from '../server/gamification/pitangaMigrationSnapshot.js';
import { reconcilePostMigrationPitangas } from '../server/gamification/pitangaPostMigrationReconciliation.js';
import type { KyrubRewardLedgerEntry } from '../shared/gamification.js';

const entry = (id: string, deltaKCoins: number, occurredAt: string): { id: string; data: KyrubRewardLedgerEntry } => ({
  id,
  data: {
    id, userId: 'user1', type: deltaKCoins > 0 ? 'earn' : 'redeem',
    deltaKCoins, sourceType: deltaKCoins > 0 ? 'challenge' : 'conversion',
    sourceId: id, correlationId: id, idempotencyKey: id, occurredAt,
  },
});
const initial = [
  entry('historical1', 3000, '2026-11-01T12:00:00Z'),
  entry('historical2', 2000, '2026-11-02T12:00:00Z'),
];
const checkpoint = buildPitangaMigrationSnapshot({
  userId: 'user1', ledgerDocuments: initial,
  completeLedgerVerified: true, legacyWritersFenced: true,
});
const later = [
  entry('earned_after', 2000, '2026-11-12T12:00:00Z'),
  entry('converted_after', -3000, '2026-11-13T12:00:00Z'),
];
const input = () => ({
  checkpoint, historicalEntryIds: ['historical1', 'historical2'],
  ledgerDocuments: [...initial, ...later],
  currentBalance: { userId: 'user1', migrationEpoch: 'epoch1', availableKCoins: 4000 },
  fenceEpoch: 'epoch1', completeLedgerVerified: true, legacyWritersFenced: true,
});
test('reconciles original 5000 Pitangas with later earning and 3 XP conversion', () => {
  assert.deepEqual(reconcilePostMigrationPitangas(input()), {
    verified: true, historicalBalance: 5000, postMigrationDelta: -1000, currentBalance: 4000,
  });
});
test('rejects mutation to an immutable historical entry', () => {
  const data = input();
  data.ledgerDocuments = data.ledgerDocuments.map(doc => doc.id === 'historical1'
    ? entry('historical1', 3001, '2026-11-01T12:00:00Z') : doc);
  assert.throws(() => reconcilePostMigrationPitangas(data), /PITANGA_RECONCILIATION_HISTORICAL_CHANGED/);
});
test('rejects missing historical membership or missing historical document', () => {
  assert.throws(() => reconcilePostMigrationPitangas({
    ...input(), historicalEntryIds: ['historical1', 'historical1'],
  }), /PITANGA_RECONCILIATION_HISTORICAL_MEMBERSHIP_INVALID/);
  assert.throws(() => reconcilePostMigrationPitangas({
    ...input(), ledgerDocuments: [...initial.slice(0, 1), ...later],
  }), /PITANGA_RECONCILIATION_HISTORICAL_ENTRY_MISSING/);
});
test('rejects out-of-band balance changes', () => {
  assert.throws(() => reconcilePostMigrationPitangas({
    ...input(), currentBalance: { userId: 'user1', migrationEpoch: 'epoch1', availableKCoins: 4001 },
  }), /PITANGA_RECONCILIATION_BALANCE_MISMATCH/);
});
test('rejects mismatched epoch, unverified fence and duplicate ledger document', () => {
  assert.throws(() => reconcilePostMigrationPitangas({
    ...input(), currentBalance: { userId: 'user1', migrationEpoch: 'other', availableKCoins: 4000 },
  }), /PITANGA_RECONCILIATION_PRECONDITIONS_INVALID/);
  assert.throws(() => reconcilePostMigrationPitangas({
    ...input(), legacyWritersFenced: false,
  }), /PITANGA_RECONCILIATION_PRECONDITIONS_INVALID/);
  assert.throws(() => reconcilePostMigrationPitangas({
    ...input(), ledgerDocuments: [...input().ledgerDocuments, initial[0]],
  }), /PITANGA_RECONCILIATION_LEDGER_SCOPE_INVALID/);
});
