import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const legacyApp = fs.readFileSync('src/LegacyApp.tsx', 'utf8');
const productivityNotes = fs.readFileSync(
  'src/hooks/useProductivityNotes.ts',
  'utf8'
);

test('legacy bootstrap does not write unsupported Firestore collections', () => {
  assert.doesNotMatch(legacyApp, /saveDocLWW/);
  assert.doesNotMatch(legacyApp, /syncOfflineBatch/);
  assert.doesNotMatch(legacyApp, /tenant_default/);

  for (const collectionPath of [
    'social_feed',
    'posts',
    'momentos',
    'delivery_jobs',
    'deliveries',
    'freelance_jobs',
    'social_tasks',
    'shared_notes'
  ]) {
    assert.equal(
      legacyApp.includes(`listenCollection('${collectionPath}'`),
      false,
      `unsupported listener remained for ${collectionPath}`
    );
  }
});

test('authorized user directory listener remains active', () => {
  assert.match(legacyApp, /listenCollection\('users'/);
});

test('notes no longer delete from the fixed legacy tenant', () => {
  assert.doesNotMatch(productivityNotes, /tenant_default/);
  assert.doesNotMatch(productivityNotes, /deleteDoc/);
  assert.doesNotMatch(productivityNotes, /from 'firebase\/firestore'/);
});
