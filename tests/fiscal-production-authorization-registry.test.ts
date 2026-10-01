import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const registrySource = readFileSync(
  'server/integrations/fiscalProductionAuthorizationRegistry.ts',
  'utf8'
);

test('production authorization registry is server-owned and tenant-scoped', () => {
  assert.match(registrySource, /adminDb/);
  assert.match(registrySource, /tenants\/\$\{tenantId\}/);
  assert.match(registrySource, /tenantId !== requestedByUserId/);
  assert.match(registrySource, /canonicalStoreId/);
  assert.match(registrySource, /fiscalProductionAuthorization\/current/);
});

test('production authorization registry preserves immutable revisions', () => {
  assert.match(registrySource, /fiscalProductionAuthorizationRevisions/);
  assert.match(registrySource, /transaction\.create/);
  assert.match(registrySource, /serverTimestamp/);
});

test('registry cannot call provider or resolve a credential value', () => {
  assert.doesNotMatch(registrySource, /fetch\s*\(/);
  assert.doesNotMatch(registrySource, /focusnfe\.com\.br/);
  assert.doesNotMatch(registrySource, /Authorization:\s*Basic/);
  assert.doesNotMatch(registrySource, /process\.env/);
  assert.match(registrySource, /credentialSecretRef/);
});

test('enabled records must pass the independent fail-closed execution gate', () => {
  assert.match(registrySource, /assertFiscalProductionExecutionAuthorized/);
  assert.match(registrySource, /authorization\.status === 'enabled'/);
});
