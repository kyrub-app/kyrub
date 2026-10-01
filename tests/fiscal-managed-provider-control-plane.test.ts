import assert from 'node:assert/strict';
import test from 'node:test';
import { managedFiscalProviderReadiness } from '../server/integrations/fiscalManagedProviderControlPlane.js';

const platform = () => ({
  schemaVersion: 1 as const,
  providerId: 'focus-nfe' as const,
  environment: 'production' as const,
  status: 'ready' as const,
  credentialSecretRef: 'gsm://projects/kyrub/secrets/focus-production',
  authority: 'server_owned_managed_fiscal_provider' as const,
});

const enrollment = () => ({
  schemaVersion: 1 as const,
  canonicalStoreId: 'store-1',
  providerId: 'focus-nfe' as const,
  documentFamily: 'nfce' as const,
  environment: 'production' as const,
  status: 'production_authorized' as const,
  authority: 'server_owned_managed_fiscal_store_enrollment' as const,
});

test('backstage reports provider and store readiness independently', () => {
  const result = managedFiscalProviderReadiness({
    canonicalStoreId: 'store-1', platform: platform(), enrollment: enrollment(),
  });
  assert.equal(result.providerReady, true);
  assert.equal(result.storeReady, true);
  assert.deepEqual(result.blockers, []);
});

test('global Focus readiness does not authorize an un-enrolled store', () => {
  const result = managedFiscalProviderReadiness({
    canonicalStoreId: 'store-1', platform: platform(), enrollment: null,
  });
  assert.equal(result.providerReady, true);
  assert.equal(result.storeReady, false);
  assert.deepEqual(result.blockers, ['store_not_production_authorized']);
});

test('store enrollment does not compensate for a disabled global provider', () => {
  const disabled = platform();
  disabled.status = 'disabled';
  const result = managedFiscalProviderReadiness({
    canonicalStoreId: 'store-1', platform: disabled, enrollment: enrollment(),
  });
  assert.equal(result.providerReady, false);
  assert.equal(result.storeReady, true);
});

test('admin readiness projection can never mint production transport authority', () => {
  const result = managedFiscalProviderReadiness({
    canonicalStoreId: 'store-1', platform: platform(), enrollment: enrollment(),
  });
  assert.equal(result.productionTrafficAllowed, false);
  assert.equal('credentialValue' in result, false);
  assert.equal('token' in result, false);
});
