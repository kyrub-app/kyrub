import assert from 'node:assert/strict';
import test from 'node:test';
import { assertLegacyPitangaWriterAllowedInTransaction } from '../server/gamification/pitangaLegacyWriterFence.js';

const ref = { path: 'systemControl/pitangaLegacyWriterFence' };
const run = (record?: Record<string, unknown>, expectedEpoch?: string) => {
  const tx = {
    get: async () => ({ exists: record !== undefined, data: () => record }),
  };
  return assertLegacyPitangaWriterAllowedInTransaction(tx as never, {
    fenceRef: ref as never, expectedEpoch,
  });
};

test('allows existing legacy operation while fence is absent or explicitly open', async () => {
  await assert.doesNotReject(run());
  await assert.doesNotReject(run({ status: 'open', epoch: 'e1' }, 'e1'));
});

test('rejects fencing and fenced states before legacy mutation', async () => {
  await assert.rejects(run({ status: 'fencing', epoch: 'e1' }),
    /PITANGA_LEGACY_WRITER_FENCED/);
  await assert.rejects(run({ status: 'fenced', epoch: 'e1' }),
    /PITANGA_LEGACY_WRITER_FENCED/);
});

test('rejects unknown states, epoch mismatches and untrusted reference', async () => {
  await assert.rejects(run({ status: 'unexpected' }), /PITANGA_LEGACY_FENCE_INVALID/);
  await assert.rejects(run({ status: 'open', epoch: 'e2' }, 'e1'),
    /PITANGA_LEGACY_FENCE_INVALID/);
  await assert.rejects(assertLegacyPitangaWriterAllowedInTransaction({
    get: async () => ({ exists: false }),
  } as never, { fenceRef: { path: 'users/other/control/fence' } as never }),
  /PITANGA_LEGACY_FENCE_REFERENCE_INVALID/);
});
