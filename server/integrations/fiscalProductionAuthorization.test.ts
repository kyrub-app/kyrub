import { describe, expect, it } from 'vitest';
import {
  assertFiscalProductionExecutionAuthorized,
  type FiscalProductionAuthorization,
} from './fiscalProductionAuthorization.js';

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

describe('fiscal production authorization gate', () => {
  it('fails closed when no explicit production authorization exists', () => {
    expect(() => assertFiscalProductionExecutionAuthorized({
      canonicalStoreId: 'store-1',
      documentFamily: 'nfce',
      authorization: null,
    })).toThrow('FISCAL_PRODUCTION_AUTHORIZATION_REQUIRED');
  });

  it('rejects disabled production authorization', () => {
    const authorization = validAuthorization();
    authorization.status = 'disabled';
    expect(() => assertFiscalProductionExecutionAuthorized({
      canonicalStoreId: 'store-1',
      documentFamily: 'nfce',
      authorization,
    })).toThrow('FISCAL_PRODUCTION_AUTHORIZATION_INVALID');
  });

  it('rejects authorization belonging to another store', () => {
    expect(() => assertFiscalProductionExecutionAuthorized({
      canonicalStoreId: 'store-2',
      documentFamily: 'nfce',
      authorization: validAuthorization(),
    })).toThrow('FISCAL_PRODUCTION_AUTHORIZATION_INVALID');
  });

  it('accepts only an explicit matching server-owned production authorization', () => {
    const authorization = validAuthorization();
    expect(assertFiscalProductionExecutionAuthorized({
      canonicalStoreId: 'store-1',
      documentFamily: 'nfce',
      authorization,
    })).toEqual(authorization);
  });
});
