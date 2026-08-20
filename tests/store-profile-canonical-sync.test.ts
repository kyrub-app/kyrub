import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const facadeSource = readFileSync(
  'server/actions/actionExecutionFacade.ts',
  'utf8'
);
const syncSource = readFileSync(
  'server/actions/storeProfileCanonicalSyncService.ts',
  'utf8'
);

test('store profile updates pass through the existing safe executor before canonical sync', () => {
  assert.match(facadeSource, /isKyrubStoreProfileExecutionRequest/);
  assert.match(facadeSource, /executeAuthorizedKyrubStoreProfileUpdate/);
  assert.match(syncSource, /executeLegacyAuthorizedKyrubAction/);
  assert.match(syncSource, /result\.type !== 'update_store_profile'/);
});

test('canonical profile sync mirrors public identity fields but not integration credentials', () => {
  for (const field of [
    'name',
    'description',
    'address',
    'contact',
    'keywords',
    'logo',
    'banner',
    'primaryColor',
    'slug',
    'plan',
  ]) {
    assert.match(syncSource, new RegExp(`${field}:`));
  }

  assert.doesNotMatch(syncSource, /operationalSettings/);
  assert.doesNotMatch(syncSource, /integrations:/);
  assert.doesNotMatch(syncSource, /externalStoreId/);
});

test('canonical sync is merge-only and refuses ambiguous store identity', () => {
  assert.match(syncSource, /STORE_IDENTITY_CONFLICT/);
  assert.match(syncSource, /canonicalReference\.set\(canonicalPatch, \{ merge: true \}\)/);
  assert.match(syncSource, /profileSyncVersion: 1/);
});
