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

test('authorized user directory stays available through shared session-bound discovery', () => {
  assert.match(legacyApp, /subscribeSocialDiscoveryDirectory\(setDbUsers\)/);
  assert.match(legacyApp, /auth\.currentUser\?\.uid!==authenticatedUserId/);
  assert.doesNotMatch(legacyApp, /listenCollection\('users'/);
  const directory = fs.readFileSync('src/utils/socialDiscoveryDirectory.ts', 'utf8');
  assert.match(directory, /where\('isProfileVisible','==',true\)/);
  assert.match(directory, /if\(socialDirectoryPilotEnabled\(\)\)return subscribePilotDirectory/);
});

test('notes use the authenticated user task path instead of the fixed legacy tenant', () => {
  assert.doesNotMatch(productivityNotes, /tenant_default/);
  assert.match(
    productivityNotes,
    /doc\(db, 'users', user\.uid, 'tasks', noteId\)/
  );
  assert.match(
    productivityNotes,
    /collection\(db, 'users', user\.uid, 'tasks'\)/
  );
});
