import assert from 'node:assert/strict';
import test from 'node:test';
import {
  assertFiscalProductionExecutionAuthorized,
  type FiscalProductionAuthorization,
} from '../server/integrations/fiscalProductionAuthorization';

const validAuthorization = (): FiscalProductionAuthorization => ({
  schemaVersion: 1,
  canonicalStoreId: 'store-1',
  documentFamily: 'nfce',
  environment: 'production',
  status: 'enabled',
  providerAdapterId: 'focus-nfe',
  providerAdapterVersion: '1',
  credentialSecretRef: 'projects/kyrub/secrets/focus-production/versions/latest',
  authorizedByUserId: 'owner-1',
  authorizedAt: '2026-10-01T12:00:00.000Z',
  authority: 'server_owned_fiscal_production_authorization',
});

test('fiscal production fails closed without explicit authorization', () => {
  assert.throws(
    () => assertFiscalProductionExecutionAuthorized({
      canonicalStoreId: 'store-1',
      documentFamily: 'nfce',
      authorization: null,
    }),
    /FISCAL_PRODUCTION_AUTHORIZATION_REQUIRED/
  );
});

test('fiscal production rejects a disabled authorization', () => {
  const authorization = validAuthorization();
  authorization.status = 'disabled';
  assert.throws(
    () => assertFiscalProductionExecutionAuthorized({
      canonicalStoreId: 'store-1',
      documentFamily: 'nfce',
      authorization,
    }),
    /FISCAL_PRODUCTION_AUTHORIZATION_INVALID/
  );
});

test('fiscal production rejects authorization belonging to another store', () => {
  assert.throws(
    () => assertFiscalProductionExecutionAuthorized({
      canonicalStoreId: 'store-2',
      documentFamily: 'nfce',
      authorization: validAuthorization(),
    }),
    /FISCAL_PRODUCTION_AUTHORIZATION_INVALID/
  );
});

test('fiscal production accepts only an explicit matching server-owned authorization', () => {
  const authorization = validAuthorization();
  assert.deepEqual(
    assertFiscalProductionExecutionAuthorized({
      canonicalStoreId: 'store-1',
      documentFamily: 'nfce',
      authorization,
    }),
    authorization
  );
});
