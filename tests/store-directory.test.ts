import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import {
  createIndependentStoreId,
  parseCanonicalStore,
  parseStoreMemberDirectoryRecord,
} from '../src/utils/storeDirectory';

describe('store directory contracts', () => {
  test('creates stable store ids independent from the owner uid', () => {
    const id = createIndependentStoreId(
      'owner-a',
      'Loja São Bento',
      1_700_000_000_000,
      'ABC123'
    );

    assert.equal(id, 'store-loja-sao-bento-loyw3v28-abc123');
    assert.notEqual(id, 'owner-a');
  });

  test('parses canonical stores and preserves migration state', () => {
    const parsed = parseCanonicalStore({
      id: 'store-a',
      ownerId: 'owner-a',
      name: 'Loja A',
      publicationStatus: 'paused',
      plan: 'free',
      legacyTenantId: 'legacy-owner-a',
      migrationStatus: 'registry_only',
      createdAt: '2026-07-22T00:00:00.000Z',
      updatedAt: '2026-07-22T00:00:00.000Z',
    });

    assert.equal(parsed?.legacyTenantId, 'legacy-owner-a');
    assert.equal(parsed?.migrationStatus, 'registry_only');
    assert.equal(
      parseCanonicalStore({
        id: 'store-a',
        ownerId: 'owner-a',
        name: 'Loja A',
        publicationStatus: 'paused',
        plan: 'free',
        migrationStatus: 'unknown',
      }),
      null
    );
  });

  test('parses only valid Kyrub store membership records', () => {
    const parsed = parseStoreMemberDirectoryRecord({
      storeId: 'store-a',
      storeName: 'Loja A',
      userId: 'seller-a',
      displayName: 'Vendedor A',
      email: 'seller@example.com',
      photoUrl: '',
      role: 'seller',
      status: 'invited',
      invitedBy: 'owner-a',
      invitedAt: '2026-07-22T00:00:00.000Z',
      acceptedAt: '',
      suspendedAt: '',
      removedAt: '',
      createdAt: '2026-07-22T00:00:00.000Z',
      updatedAt: '2026-07-22T00:00:00.000Z',
    });

    assert.equal(parsed?.role, 'seller');
    assert.equal(parsed?.status, 'invited');
    assert.equal(
      parseStoreMemberDirectoryRecord({
        storeId: 'store-a',
        userId: 'seller-a',
        role: 'waiter',
        status: 'active',
      }),
      null
    );
  });
});
