import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';

const source = await readFile(new URL('../server/integrations/fiscalManagedStoreEnrollment.ts', import.meta.url), 'utf8');

test('store enrollment preparation is fail-closed and cannot grant production authorization', () => {
  assert.match(source, /status:\s*'prepared'/);
  assert.doesNotMatch(source, /status:\s*'production_authorized'\s*,/);
  assert.doesNotMatch(source, /adminDb\.doc\(`stores\/\$\{canonicalStoreId\}`\)/);
  assert.doesNotMatch(source, /FISCAL_STORE_NOT_FOUND/);
});

test('managed enrollment has one canonical write authority with read-only legacy compatibility', () => {
  assert.match(source, /kyrub_admin\/control_plane\/fiscal_store_enrollments\/\$\{canonicalStoreId\}/);
  assert.match(source, /kyrub_admin\/fiscal\/store_enrollments\/\$\{canonicalStoreId\}/);
  assert.match(source, /source:\s*'canonical'/);
  assert.match(source, /source:\s*'legacy'/);
  assert.match(source, /const ref = managedEnrollmentRef\(canonicalStoreId\)/);
  assert.doesNotMatch(source, /legacyEnrollmentRef\(canonicalStoreId\)\.set/);
});

test('protected enrollment states require a separate control path', () => {
  assert.match(source, /existing\?\.status === 'production_authorized'/);
  assert.match(source, /existing\?\.status === 'suspended'/);
  assert.match(source, /FISCAL_STORE_ENROLLMENT_STATE_REQUIRES_SEPARATE_CONTROL/);
});

test('prepared enrollment remains server-owned and scoped to NFC-e production provider', () => {
  assert.match(source, /providerId:\s*'focus-nfe'/);
  assert.match(source, /documentFamily:\s*'nfce'/);
  assert.match(source, /authority:\s*'server_owned_managed_fiscal_store_enrollment'/);
});
