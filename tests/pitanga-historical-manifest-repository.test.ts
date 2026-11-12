import assert from 'node:assert/strict';
import test from 'node:test';
import { persistPitangaHistoricalManifestInTransaction, recoverPitangaHistoricalManifestInTransaction } from '../server/gamification/pitangaHistoricalManifestRepository.js';

const userId = 'user1';
const fenceEpoch = 'epoch1';
const historicalEntryIds = Array.from({ length: 205 }, (_, i) => `entry_${i}`);
const chunkRefs = Array.from({ length: 3 }, (_, i) => ({
  path: `users/${userId}/pitangaMigrationManifest/${fenceEpoch}_${String(i).padStart(6, '0')}`,
}));
const fixture = (records: Record<string, Record<string, unknown>>) => {
  const writes: Array<{ path: string; data: Record<string, unknown> }> = [];
  const tx = {
    get: async (ref: { path: string }) => ({
      exists: Object.hasOwn(records, ref.path), data: () => records[ref.path],
    }),
    create: (ref: { path: string }, data: Record<string, unknown>) => {
      writes.push({ path: ref.path, data }); records[ref.path] = data;
    },
  };
  const run = (refs = chunkRefs) => persistPitangaHistoricalManifestInTransaction(tx as never, {
    userId, fenceEpoch, historicalEntryIds, chunkRefs: refs as never,
  });
  return { writes, run };
};

test('creates immutable chunks and replays without new writes', async () => {
  const records: Record<string, Record<string, unknown>> = {};
  const { writes, run } = fixture(records);
  const first = await run();
  assert.equal(first.replay, false);
  assert.equal(first.entryCount, 205);
  assert.equal(writes.length, 3);
  assert.equal((await run()).replay, true);
  assert.equal(writes.length, 3);
});

test('rejects partial manifest and altered stored chunk without writes', async () => {
  const records: Record<string, Record<string, unknown>> = {};
  const { run, writes } = fixture(records);
  await run();
  delete records[chunkRefs[1].path];
  await assert.rejects(run(), /PITANGA_MANIFEST_PARTIAL_STATE/);
  records[chunkRefs[1].path] = writes[1].data;
  records[chunkRefs[1].path] = { ...records[chunkRefs[1].path], sha256: '0'.repeat(64) };
  await assert.rejects(run(), /PITANGA_MANIFEST_CHUNK_INVALID/);
  assert.equal(writes.length, 3);
});

test('rejects foreign chunk references before reads or writes', async () => {
  const { run, writes } = fixture({});
  await assert.rejects(run([{ path: 'users/other/pitangaMigrationManifest/epoch1_000000' }, ...chunkRefs.slice(1)]),
    /PITANGA_MANIFEST_REFERENCE_INVALID/);
  assert.equal(writes.length, 0);
});

test('recovers IDs from stored chunks only when receipt matches', async () => {
  const records: Record<string, Record<string, unknown>> = {};
  const { run } = fixture(records);
  const saved = await run();
  const receiptRef = { path: `users/${userId}/pitangaMigration/receipt` };
  records[receiptRef.path] = {
    userId, fenceEpoch, entryCount: saved.entryCount,
    historicalMembershipSha256: saved.membershipSha256,
  };
  const tx = { get: async (ref: { path: string }) => ({
    exists: Object.hasOwn(records, ref.path), data: () => records[ref.path],
  }) };
  const recover = () => recoverPitangaHistoricalManifestInTransaction(tx as never, {
    userId, fenceEpoch, receiptRef: receiptRef as never, chunkRefs: chunkRefs as never,
  });
  assert.deepEqual(await recover(), [...historicalEntryIds].sort());
  records[receiptRef.path].historicalMembershipSha256 = '0'.repeat(64);
  await assert.rejects(recover(), /PITANGA_MANIFEST_MEMBERSHIP_INVALID/);
  records[receiptRef.path].historicalMembershipSha256 = saved.membershipSha256;
  delete records[chunkRefs[0].path];
  await assert.rejects(recover(), /PITANGA_MANIFEST_INCOMPLETE/);
});
