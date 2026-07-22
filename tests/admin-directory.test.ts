import assert from 'node:assert/strict';
import test from 'node:test';
import {
  mergeAdminDirectoryStoreLinks,
  parseAdminDirectoryLegacyTenant,
  parseAdminDirectoryLookup,
  parseAdminDirectoryStore,
  parseAdminDirectoryUser,
  type AdminDirectoryStoreLink,
} from '../src/utils/adminDirectory';

test('directory accepts only exact e-mail or safe UID lookups', () => {
  assert.deepEqual(parseAdminDirectoryLookup('  USER@Example.COM  '), {
    kind: 'email',
    value: 'user@example.com',
  });
  assert.deepEqual(parseAdminDirectoryLookup('uid_123-ABC'), {
    kind: 'uid',
    value: 'uid_123-ABC',
  });
  assert.equal(parseAdminDirectoryLookup('user@example'), null);
  assert.equal(parseAdminDirectoryLookup('partial name'), null);
  assert.equal(parseAdminDirectoryLookup(''), null);
});

test('user parser preserves only supported directory fields', () => {
  assert.deepEqual(
    parseAdminDirectoryUser(
      {
        uid: 'user-a',
        name: 'Pessoa A',
        email: 'PERSON@EXAMPLE.COM',
        photoUrl: 'https://example.com/photo.png',
        isProfileVisible: true,
        createdAt: '2026-07-22T00:00:00.000Z',
        updatedAt: '2026-07-23T00:00:00.000Z',
        ignoredSecret: 'never expose',
      },
      'user-a'
    ),
    {
      uid: 'user-a',
      name: 'Pessoa A',
      email: 'person@example.com',
      photoUrl: 'https://example.com/photo.png',
      isProfileVisible: true,
      createdAt: '2026-07-22T00:00:00.000Z',
      updatedAt: '2026-07-23T00:00:00.000Z',
    }
  );
  assert.equal(
    parseAdminDirectoryUser({ uid: 'other-user' }, 'user-a'),
    null
  );
});

test('store and tenant parsers expose migration and plan metadata without inventing values', () => {
  assert.deepEqual(
    parseAdminDirectoryStore(
      {
        id: 'store-a',
        name: 'Loja A',
        plan: 'business',
        publicationStatus: 'published',
        migrationStatus: 'dual_write',
        legacyTenantId: 'legacy-a',
      },
      'store-a',
      'owner'
    ),
    {
      storeId: 'store-a',
      storeName: 'Loja A',
      relationship: 'owner',
      role: 'owner',
      membershipStatus: 'active',
      plan: 'business',
      publicationStatus: 'published',
      migrationStatus: 'dual_write',
      legacyTenantId: 'legacy-a',
    }
  );

  assert.deepEqual(
    parseAdminDirectoryLegacyTenant(
      {
        businessName: 'Loja Legada',
        ownerId: 'user-a',
      },
      'legacy-a'
    ),
    {
      tenantId: 'legacy-a',
      name: 'Loja Legada',
      ownerId: 'user-a',
      plan: '',
      status: '',
    }
  );
});

test('owned store wins over duplicate membership link', () => {
  const owned: AdminDirectoryStoreLink = {
    storeId: 'store-a',
    storeName: 'Loja A',
    relationship: 'owner',
    role: 'owner',
    membershipStatus: 'active',
    plan: 'business',
    publicationStatus: 'published',
    migrationStatus: 'canonical',
    legacyTenantId: 'legacy-a',
  };
  const membership: AdminDirectoryStoreLink = {
    ...owned,
    relationship: 'member',
    role: 'manager',
  };
  const second: AdminDirectoryStoreLink = {
    ...owned,
    storeId: 'store-b',
    storeName: 'Loja B',
    relationship: 'member',
    role: 'seller',
  };

  assert.deepEqual(
    mergeAdminDirectoryStoreLinks([owned], [membership, second]),
    [owned, second]
  );
});
