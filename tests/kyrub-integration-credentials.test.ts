import assert from 'node:assert/strict';
import test from 'node:test';
import {
  assertIntegrationCredentialRecord,
  assertNoRawIntegrationSecrets,
  publicIntegrationCredentialView,
  type KyrubIntegrationCredentialRecord,
} from '../shared/integrationCredentials';

const record: KyrubIntegrationCredentialRecord = {
  id: 'mercado_pago:sandbox',
  providerId: 'mercado_pago',
  environment: 'sandbox',
  status: 'configured',
  enabled: false,
  credentials: {
    access_token: {
      secretRef: 'vault://integrations/mercado-pago/sandbox/access-token',
      last4: 'X9A2',
      version: '1',
      updatedAt: '2026-08-22T00:00:00.000Z',
    },
  },
  createdAt: '2026-08-22T00:00:00.000Z',
  updatedAt: '2026-08-22T00:00:00.000Z',
};

test('integration metadata stores opaque references instead of raw provider secrets', () => {
  assert.equal(assertIntegrationCredentialRecord(record).credentials.access_token.secretRef.startsWith('vault://'), true);
});

test('browser-safe view never returns the secret reference itself', () => {
  const view = publicIntegrationCredentialView(record);
  assert.deepEqual(view.credentials.access_token, {
    configured: true,
    last4: 'X9A2',
    version: '1',
    updatedAt: '2026-08-22T00:00:00.000Z',
  });
  assert.equal('secretRef' in view.credentials.access_token, false);
});

test('raw token-like fields are rejected before persistence', () => {
  assert.throws(() => assertNoRawIntegrationSecrets({
    providerId: 'mercado_pago',
    accessToken: 'APP_USR-this-must-never-be-stored-here',
  }), /Segredo bruto proibido/);
  assert.throws(() => assertNoRawIntegrationSecrets({
    nested: { api_key: 'real-provider-key' },
  }), /Segredo bruto proibido/);
  assert.throws(() => assertNoRawIntegrationSecrets({
    nested: { api_secret: 'real-provider-secret' },
  }), /Segredo bruto proibido/);
  assert.throws(() => assertNoRawIntegrationSecrets({
    refresh_token: 'refresh-value',
  }), /Segredo bruto proibido/);
});

test('credential slots reject malformed runtime payloads instead of trusting TypeScript casts', () => {
  const malformed = {
    ...record,
    credentials: {
      access_token: 'raw-value',
    },
  } as unknown as KyrubIntegrationCredentialRecord;
  assert.throws(
    () => assertIntegrationCredentialRecord(malformed),
    /somente metadados de referência/
  );
});

test('saving credentials does not imply production activation', () => {
  const validated = assertIntegrationCredentialRecord({ ...record, environment: 'production', status: 'configured', enabled: false });
  assert.equal(validated.enabled, false);
  assert.equal(validated.status, 'configured');
});
