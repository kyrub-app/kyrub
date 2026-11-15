import assert from 'node:assert/strict';
import test from 'node:test';
import { assertLegacyPitangaWriterAllowedInTransaction } from '../server/gamification/pitangaLegacyWriterFence.js';
import { applyPitangaXpConversionInTransaction } from '../server/gamification/pitangaXpConversionTransaction.js';

const ref = { path: 'systemControl/pitangaLegacyWriterFence' } as never;
const transaction = (data?: Record<string, unknown>) => ({
  get: async () => ({ exists: data !== undefined, data: () => data }),
}) as never;

test('legacy writer fence permits pre-cutover missing record but never treats it as verified', async () => {
  await assert.doesNotReject(assertLegacyPitangaWriterAllowedInTransaction(transaction(), { fenceRef: ref }));
});

test('legacy writer fence rejects active fencing and fully fenced epochs', async () => {
  for (const status of ['fencing', 'fenced']) {
    await assert.rejects(assertLegacyPitangaWriterAllowedInTransaction(transaction({ status, epoch: 'e1' }), { fenceRef: ref }), /PITANGA_LEGACY_WRITER_FENCED/);
  }
});

test('legacy writer fence permits only explicitly open matching epochs', async () => {
  await assert.doesNotReject(assertLegacyPitangaWriterAllowedInTransaction(transaction({ status: 'open', epoch: 'e1' }), { fenceRef: ref, expectedEpoch: 'e1' }));
  await assert.rejects(assertLegacyPitangaWriterAllowedInTransaction(transaction({ status: 'open', epoch: 'e2' }), { fenceRef: ref, expectedEpoch: 'e1' }), /PITANGA_LEGACY_FENCE_INVALID/);
  await assert.rejects(assertLegacyPitangaWriterAllowedInTransaction(transaction({ status: 'unknown' }), { fenceRef: ref }), /PITANGA_LEGACY_FENCE_INVALID/);
  await assert.rejects(assertLegacyPitangaWriterAllowedInTransaction(transaction({ status: 'open' }), { fenceRef: { path: 'users/u/other' } as never }), /PITANGA_LEGACY_FENCE_REFERENCE_INVALID/);
});

test('migrated XP conversion requires a fenced matching receipt in the same transaction', async () => {
  const uid = 'migration_test';
  const root = `users/${uid}`;
  const makeRef = (path: string) => ({ path, id: path.split('/').at(-1), parent: { path: path.split('/').slice(0, -1).join('/') } });
  const balanceRef = makeRef(`${root}/pitangaBalance/balance`);
  const migrationReceiptRef = makeRef(`${root}/pitangaMigration/receipt`);
  const fenceRef = makeRef('systemControl/pitangaLegacyWriterFence');
  const input = {
    userId: uid, requestId: 'req1', requestedXp: 1, occurredAt: '2026-11-15T00:00:00Z',
    balanceRef, migrationReceiptRef, legacyFenceRef: fenceRef,
    debitRef: makeRef(`${root}/rewardLedger/conversion_req1`),
    xpRef: makeRef(`${root}/xpLedger/conversion_req1`),
    receiptRef: makeRef(`${root}/pitangaXpConversions/req1`),
    migratedEvidence: { migrationReceiptRef },
  };
  const digest = 'a'.repeat(64);
  const documents: Record<string, Record<string, unknown>> = {
    [fenceRef.path]: { status: 'fenced', writersVerified: true, epoch: 'e1' },
    [migrationReceiptRef.path]: {
      userId: uid, fenceEpoch: 'e1', balance: 2000, entryCount: 1,
      ledgerSha256: digest, historicalMembershipSha256: digest,
    },
    [balanceRef.path]: { userId: uid, migrationEpoch: 'e1', availableKCoins: 2000 },
  };
  const writes: string[] = [];
  const tx = {
    get: async (ref: { path: string }) => ({
      exists: documents[ref.path] !== undefined,
      data: () => documents[ref.path],
    }),
    update: (ref: { path: string }) => writes.push('update:' + ref.path),
    create: (ref: { path: string }) => writes.push('create:' + ref.path),
  };
  const result = await applyPitangaXpConversionInTransaction(tx as never, input as never);
  assert.equal(result.pitangasDebited, 1000);
  assert.equal(result.xpCredited, 1);
  assert.equal(writes.length, 4);
  writes.length = 0;
  documents[fenceRef.path] = { status: 'fenced', writersVerified: false, epoch: 'e1' };
  await assert.rejects(applyPitangaXpConversionInTransaction(tx as never, input as never), /CONVERSION_MIGRATION_UNVERIFIED/);
  assert.equal(writes.length, 0);
  documents[fenceRef.path] = { status: 'fenced', writersVerified: true, epoch: 'e2' };
  await assert.rejects(applyPitangaXpConversionInTransaction(tx as never, input as never), /CONVERSION_MIGRATION_UNVERIFIED/);
  assert.equal(writes.length, 0);
});
