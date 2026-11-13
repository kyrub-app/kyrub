import test from 'node:test';
import assert from 'node:assert/strict';
import { assertLegacyPitangaWriterAllowedInTransaction } from '../server/gamification/pitangaLegacyWriterFence.js';

const fenceRef = { path: 'systemControl/pitangaLegacyWriterFence' } as any;

function transaction(fence?: { status: string; epoch?: string }) {
  let reads = 0;
  const tx = {
    get: async () => {
      reads += 1;
      return { exists: !!fence, data: () => fence };
    },
  } as any;
  return { tx, get reads() { return reads; } };
}

test('legacy writer is permitted with no control document before migration', async () => {
  const mock = transaction();
  await assertLegacyPitangaWriterAllowedInTransaction(mock.tx, { fenceRef });
  assert.equal(mock.reads, 1);
});

test('epoch-bound writer fails closed when fence document is missing', async () => {
  const mock = transaction();
  await assert.rejects(
    assertLegacyPitangaWriterAllowedInTransaction(mock.tx, { fenceRef, expectedEpoch: 'epoch_1' }),
    /PITANGA_LEGACY_FENCE_MISSING/,
  );
  assert.equal(mock.reads, 1);
});

test('legacy writer is permitted only for open control with matching epoch', async () => {
  const mock = transaction({ status: 'open', epoch: 'epoch_1' });
  await assertLegacyPitangaWriterAllowedInTransaction(mock.tx, { fenceRef, expectedEpoch: 'epoch_1' });
  assert.equal(mock.reads, 1);
});

test('fencing and fenced states reject all legacy writes', async () => {
  for (const status of ['fencing', 'fenced']) {
    const mock = transaction({ status, epoch: 'epoch_1' });
    await assert.rejects(
      assertLegacyPitangaWriterAllowedInTransaction(mock.tx, { fenceRef, expectedEpoch: 'epoch_1' }),
      /PITANGA_LEGACY_WRITER_FENCED/,
    );
    assert.equal(mock.reads, 1);
  }
});

test('unknown state and mismatched epoch fail closed', async () => {
  for (const fence of [{ status: 'unexpected', epoch: 'epoch_1' }, { status: 'open', epoch: 'epoch_2' }]) {
    const mock = transaction(fence);
    await assert.rejects(
      assertLegacyPitangaWriterAllowedInTransaction(mock.tx, { fenceRef, expectedEpoch: 'epoch_1' }),
      /PITANGA_LEGACY_FENCE_INVALID/,
    );
  }
});

test('wrong control reference is rejected before transaction reads', async () => {
  const mock = transaction({ status: 'open', epoch: 'epoch_1' });
  await assert.rejects(
    assertLegacyPitangaWriterAllowedInTransaction(mock.tx, {
      fenceRef: { path: 'users/other/pitangaLegacyWriterFence' } as any,
    }),
    /PITANGA_LEGACY_FENCE_REFERENCE_INVALID/,
  );
  assert.equal(mock.reads, 0);
});
