import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

test('store connection registry is tenant-scoped and stores only Vault references', () => {
  const source = readFileSync('server/integrations/storeConnectionRegistry.ts', 'utf8');
  assert.match(source, /stores\/\$\{storeId\}\/storeConnections\/\$\{connectionId\}/);
  assert.match(source, /assertStoreConnectionTenant/);
  assert.match(source, /credentialAuthority: 'vault'/);
  assert.match(source, /STORE_CONNECTION_PLAINTEXT_CREDENTIAL_FORBIDDEN/);
  assert.doesNotMatch(source, /accessToken\s*:/);
  assert.doesNotMatch(source, /refreshToken\s*:/);
});
