import assert from 'node:assert/strict';
import test from 'node:test';
import { assertLegacyPitangaWriterAllowedInTransaction } from '../server/gamification/pitangaLegacyWriterFence.js';

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
