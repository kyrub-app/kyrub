import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import {
  publicIntegrationCredentialView,
  type KyrubIntegrationCredentialRecord,
} from '../shared/integrationCredentials';

const resolverSource = readFileSync(
  'server/integrations/providerCredentialResolver.ts',
  'utf8'
);
const credentialServiceSource = readFileSync(
  'server/admin/integrationCredentialService.ts',
  'utf8'
);
const clientSource = readFileSync(
  'src/utils/adminIntegrationReadiness.ts',
  'utf8'
);

test('Mercado Pago resolver checks Vault before controlled environment fallback', () => {
  const vaultLookup = resolverSource.indexOf(
    "resolvePlatformCredentials('mercado_pago', environment)"
  );
  const environmentFallback = resolverSource.lastIndexOf('return environmentFallback()');

  assert.ok(vaultLookup >= 0, 'Vault lookup must exist');
  assert.ok(
    environmentFallback > vaultLookup,
    'Environment fallback must remain after the Vault lookup'
  );
  assert.match(resolverSource, /authority: 'vault_v1'/);
  assert.match(resolverSource, /authority: accessToken \|\| webhookSecret \? 'environment' : 'none'/);
});

test('public credential view strips secretRef while preserving masked metadata', () => {
  const record: KyrubIntegrationCredentialRecord = {
    id: 'mercado_pago__production',
    providerId: 'mercado_pago',
    environment: 'production',
    status: 'configured',
    enabled: true,
    credentials: {
      access_token: {
        secretRef: 'legacy-envelope://mercado_pago__production/access_token',
        last4: 'AB12',
        updatedAt: '2026-08-22T00:00:00.000Z',
      },
      webhook_secret: {
        secretRef: 'legacy-envelope://mercado_pago__production/webhook_secret',
        last4: 'CD34',
        updatedAt: '2026-08-22T00:00:00.000Z',
      },
    },
    createdAt: '2026-08-22T00:00:00.000Z',
    updatedAt: '2026-08-22T00:00:00.000Z',
  };

  const publicView = publicIntegrationCredentialView(record);
  const serialized = JSON.stringify(publicView);

  assert.equal(serialized.includes('secretRef'), false);
  assert.deepEqual(publicView.credentials.access_token, {
    configured: true,
    last4: 'AB12',
    updatedAt: '2026-08-22T00:00:00.000Z',
  });
  assert.deepEqual(publicView.credentials.webhook_secret, {
    configured: true,
    last4: 'CD34',
    updatedAt: '2026-08-22T00:00:00.000Z',
  });
});

test('admin credential operations return public views and client only reads masked fields', () => {
  assert.match(credentialServiceSource, /return publicIntegrationCredentialView\(record\)/);
  assert.match(
    credentialServiceSource,
    /credential: record \? publicIntegrationCredentialView\(record\) : null/
  );
  assert.match(clientSource, /safeString\(access\.last4\)/);
  assert.match(clientSource, /safeString\(webhook\.last4\)/);
  assert.doesNotMatch(clientSource, /safeString\([^\n]*secretRef/);
});
