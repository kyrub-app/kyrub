import assert from 'node:assert/strict';
import test from 'node:test';
import { buildPitangaHistoricalManifest, verifyPitangaHistoricalManifest } from '../server/gamification/pitangaHistoricalManifest.js';

const fixture = () => buildPitangaHistoricalManifest({
  userId: 'user1', fenceEpoch: 'epoch1',
  entryIds: Array.from({ length: 205 }, (_, i) => `entry_${String(i).padStart(4, '0')}`).reverse(),
});
const expected = (manifest: ReturnType<typeof fixture>) => ({
  userId: manifest.userId, fenceEpoch: manifest.fenceEpoch,
  entryCount: manifest.entryCount, membershipSha256: manifest.membershipSha256,
});

test('manifest deterministically chunks and restores historical IDs', () => {
  const manifest = fixture();
  assert.deepEqual(manifest.chunks.map(chunk => chunk.entryIds.length), [100, 100, 5]);
  assert.deepEqual(verifyPitangaHistoricalManifest(manifest, expected(manifest)),
    Array.from({ length: 205 }, (_, i) => `entry_${String(i).padStart(4, '0')}`));
  assert.deepEqual(fixture(), manifest);
});

test('rejects omitted, reordered or modified chunks', () => {
  for (const change of [
    (m: ReturnType<typeof fixture>) => { m.chunks.pop(); },
    (m: ReturnType<typeof fixture>) => { m.chunks.reverse(); },
    (m: ReturnType<typeof fixture>) => { m.chunks[0].entryIds[0] = 'substituted'; },
    (m: ReturnType<typeof fixture>) => { m.chunks[1].sha256 = '0'.repeat(64); },
  ]) {
    const manifest = fixture();
    change(manifest);
    assert.throws(() => verifyPitangaHistoricalManifest(manifest, expected(fixture())), /PITANGA_MANIFEST_/);
  }
});

test('rejects mismatched receipt metadata and duplicate IDs', () => {
  const manifest = fixture();
  assert.throws(() => verifyPitangaHistoricalManifest(manifest, {
    ...expected(manifest), fenceEpoch: 'other',
  }), /PITANGA_MANIFEST_MISMATCH/);
  assert.throws(() => buildPitangaHistoricalManifest({
    userId: 'user1', fenceEpoch: 'epoch1', entryIds: ['same', 'same'],
  }), /PITANGA_HISTORICAL_MEMBERSHIP_INVALID/);
});

test('supports empty historical ledger', () => {
  const manifest = buildPitangaHistoricalManifest({ userId: 'user1', fenceEpoch: 'epoch1', entryIds: [] });
  assert.deepEqual(verifyPitangaHistoricalManifest(manifest, expected(manifest)), []);
});
