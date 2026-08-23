import assert from 'node:assert/strict';
import test from 'node:test';
import {
  assertImportAuthority,
  assertImportProvenance,
  assertSameTenant,
  assertSyncPolicy,
} from '../shared/omnichannelImportAuthority';

test('external imports require connection and external identity provenance', () => {
  const valid = { storeId: 'store-1', connectionId: 'conn-1', source: 'mercado_livre' as const, externalId: 'sku-1', importedAt: '2026-08-23T18:00:00Z' };
  assert.equal(assertImportProvenance(valid), valid);
  assert.throws(() => assertImportProvenance({ ...valid, connectionId: undefined }), /PROVENANCE_CONNECTION_REQUIRED/);
  assert.throws(() => assertImportProvenance({ ...valid, externalId: undefined }), /PROVENANCE_EXTERNAL_ID_REQUIRED/);
});

test('bidirectional sync fails closed without manual conflict review', () => {
  const base = { storeId: 'store-1', connectionId: 'conn-1', authority: 'bidirectional' as const, conflictPolicy: 'manual_review' as const, enabled: true };
  assert.equal(assertSyncPolicy(base), base);
  assert.throws(() => assertSyncPolicy({ ...base, conflictPolicy: 'external_wins' }), /BIDIRECTIONAL_SYNC_REQUIRES_MANUAL_REVIEW/);
});

test('tenant isolation rejects cross-store provenance and sync authority', () => {
  assert.throws(() => assertSameTenant('store-1', 'store-2', 'connection'), /TENANT_ISOLATION_VIOLATION/);
  const provenance = { storeId: 'store-2', connectionId: 'conn-1', source: 'shopee' as const, externalId: 'sku-9', importedAt: '2026-08-23T18:00:00Z' };
  const policy = { storeId: 'store-1', connectionId: 'conn-1', authority: 'external_to_kyrub' as const, conflictPolicy: 'external_wins' as const, enabled: true };
  assert.throws(() => assertImportAuthority('store-1', provenance, policy), /TENANT_ISOLATION_VIOLATION:provenance/);
});

test('connection identity must match authority policy', () => {
  const provenance = { storeId: 'store-1', connectionId: 'conn-a', source: 'ifood' as const, externalId: 'item-1', importedAt: '2026-08-23T18:00:00Z' };
  const policy = { storeId: 'store-1', connectionId: 'conn-b', authority: 'external_to_kyrub' as const, conflictPolicy: 'external_wins' as const, enabled: true };
  assert.throws(() => assertImportAuthority('store-1', provenance, policy), /CONNECTION_AUTHORITY_MISMATCH/);
});
