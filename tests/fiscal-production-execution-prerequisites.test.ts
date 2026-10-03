import assert from 'node:assert/strict';
import test from 'node:test';
import {
  assertFiscalProductionExecutionPrerequisites,
  type FiscalProductionProviderConfiguration,
} from '../server/integrations/fiscalProductionExecutionPrerequisites.js';
import type { FiscalProductionAuthorization } from '../server/integrations/fiscalProductionAuthorization.js';

const secretRef = 'gsm://projects/kyrub/secrets/focus-production';

const authorization = (): FiscalProductionAuthorization => ({
  schemaVersion: 1,
  canonicalStoreId: 'store-1',
  documentFamily: 'nfce',
  environment: 'production',
  status: 'enabled',
  providerAdapterId: 'focus-nfe',
  providerAdapterVersion: '1',
  credentialSecretRef: secretRef,
  authorizedByUserId: 'owner-1',
  authorizedAt: '2026-10-01T13:00:00.000Z',
  authority: 'server_owned_fiscal_production_authorization',
});

const configuration = (): FiscalProductionProviderConfiguration => ({
  schemaVersion: 1,
  canonicalStoreId: 'store-1',
  documentFamily: 'nfce',
  environment: 'production',
  status: 'active',
  adapterId: 'focus-nfe',
  adapterVersion: '1',
  credentialSecretRef: secretRef,
  authority: 'server_owned_fiscal_provider_configuration',
});

const credential = () => ({
  secretRef,
  version: '7',
  resourceName: 'projects/kyrub/secrets/focus-production/versions/7',
  value: 'server-only-token',
});

test('production prerequisites require all three independent authorities', () => {
  assert.throws(() => assertFiscalProductionExecutionPrerequisites({
    canonicalStoreId: 'store-1', authorization: authorization(), configuration: null, credential: credential(),
  }), /FISCAL_PRODUCTION_PROVIDER_CONFIGURATION_REQUIRED/);
  assert.throws(() => assertFiscalProductionExecutionPrerequisites({
    canonicalStoreId: 'store-1', authorization: authorization(), configuration: configuration(), credential: null,
  }), /FISCAL_PRODUCTION_CREDENTIAL_REQUIRED/);
});

test('authorization must match provider configuration exactly', () => {
  const config = configuration();
  config.adapterVersion = '2';
  assert.throws(() => assertFiscalProductionExecutionPrerequisites({
    canonicalStoreId: 'store-1', authorization: authorization(), configuration: config, credential: credential(),
  }), /FISCAL_PRODUCTION_AUTHORIZATION_CONFIGURATION_MISMATCH/);
});

test('credential must come from the configured secret reference', () => {
  const evidence = credential();
  evidence.secretRef = 'gsm://projects/kyrub/secrets/another-secret';
  assert.throws(() => assertFiscalProductionExecutionPrerequisites({
    canonicalStoreId: 'store-1', authorization: authorization(), configuration: configuration(), credential: evidence,
  }), /FISCAL_PRODUCTION_CREDENTIAL_INVALID/);
});

test('matching authorization, configuration and credential pass without provider traffic', () => {
  const result = assertFiscalProductionExecutionPrerequisites({
    canonicalStoreId: 'store-1', authorization: authorization(), configuration: configuration(), credential: credential(),
  });
  assert.equal(result.configuration.environment, 'production');
  assert.equal(result.credential.version, '7');
});
