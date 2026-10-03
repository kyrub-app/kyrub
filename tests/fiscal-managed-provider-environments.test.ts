import assert from 'node:assert/strict';
import test from 'node:test';
import { managedFiscalProviderReadiness, type ManagedFiscalProviderPlatformConfig, type ManagedFiscalStoreEnrollment } from '../server/integrations/fiscalManagedProviderControlPlane.js';

const platform: ManagedFiscalProviderPlatformConfig = {
  schemaVersion: 1,
  providerId: 'focus-nfe',
  environment: 'production',
  status: 'ready',
  credentialSecretRef: 'server-secret-ref',
  authority: 'server_owned_managed_fiscal_provider',
};

const enrollment = (overrides: Partial<ManagedFiscalStoreEnrollment> = {}): ManagedFiscalStoreEnrollment => ({
  schemaVersion: 1,
  canonicalStoreId: 'store-1',
  providerId: 'focus-nfe',
  documentFamily: 'nfce',
  environment: 'homologation',
  status: 'homologation_ready',
  authority: 'server_owned_managed_fiscal_store_enrollment',
  ...overrides,
});

test('homologation can be ready without granting production traffic', () => {
  const readiness = managedFiscalProviderReadiness({ canonicalStoreId: 'store-1', platform, enrollment: enrollment() });
  assert.equal(readiness.providerReady, true);
  assert.equal(readiness.homologationTrafficAllowed, true);
  assert.equal(readiness.storeReady, false);
  assert.equal(readiness.productionTrafficAllowed, false);
});

test('prepared homologation enrollment does not grant any traffic', () => {
  const readiness = managedFiscalProviderReadiness({ canonicalStoreId: 'store-1', platform, enrollment: enrollment({ status: 'prepared' }) });
  assert.equal(readiness.homologationTrafficAllowed, false);
  assert.equal(readiness.productionTrafficAllowed, false);
});

test('production authorization remains distinct from homologation readiness', () => {
  const readiness = managedFiscalProviderReadiness({ canonicalStoreId: 'store-1', platform, enrollment: enrollment({ environment: 'production', status: 'production_authorized' }) });
  assert.equal(readiness.homologationTrafficAllowed, false);
  assert.equal(readiness.storeReady, true);
  assert.equal(readiness.productionTrafficAllowed, false);
});

test('mismatched store cannot inherit another issuer readiness', () => {
  const readiness = managedFiscalProviderReadiness({ canonicalStoreId: 'store-2', platform, enrollment: enrollment() });
  assert.equal(readiness.homologationTrafficAllowed, false);
  assert.equal(readiness.storeReady, false);
  assert.equal(readiness.productionTrafficAllowed, false);
});
