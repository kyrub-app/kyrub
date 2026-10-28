import assert from 'node:assert/strict';
import test from 'node:test';
import { hasStoreAccessPermission, resolveStoreAccessPermissions, type StoreAccessProfile } from '../src/utils/storeAccessProfiles';
import { STORE_ROLE_PERMISSIONS } from '../src/utils/storeSecurity';

const profile: StoreAccessProfile = {
  id: 'shift-lead', storeId: 'store-a', name: 'Líder de turno', baseRole: 'manager',
  permissions: ['orders.read', 'orders.cancel', 'cash.read'], active: true,
};
const assignment = { profileId: 'shift-lead' };

test('legacy members without assignment retain their existing role permissions', () => {
  assert.deepEqual(resolveStoreAccessPermissions('manager', 'store-a'), STORE_ROLE_PERMISSIONS.manager);
});

test('custom profile restricts the technical role and cannot grant ownership transfer', () => {
  assert.deepEqual(resolveStoreAccessPermissions('manager', 'store-a', assignment, profile),
    ['orders.read', 'orders.cancel', 'cash.read']);
  assert.equal(hasStoreAccessPermission('manager', 'store-a', 'ownership.transfer', assignment, profile), false);
});

test('missing, inactive, mismatched and cross-store profiles fail closed', () => {
  for (const invalid of [null, { ...profile, active: false }, { ...profile, storeId: 'store-b' },
    { ...profile, baseRole: 'seller' as const }, { ...profile, id: 'different' }]) {
    assert.deepEqual(resolveStoreAccessPermissions('manager', 'store-a', assignment, invalid), []);
  }
});

test('member-specific revocation removes permissions', () => {
  assert.deepEqual(resolveStoreAccessPermissions('manager', 'store-a',
    { ...assignment, revokedPermissions: ['orders.cancel'] }, profile), ['orders.read', 'cash.read']);
});

test('owner access cannot be reduced by a staff profile', () => {
  assert.deepEqual(resolveStoreAccessPermissions('owner', 'store-a', assignment, profile), STORE_ROLE_PERMISSIONS.owner);
});

test('malformed or escalated profile permissions are rejected', () => {
  assert.deepEqual(resolveStoreAccessPermissions('manager', 'store-a', assignment,
    { ...profile, permissions: ['orders.read', 'ownership.transfer'] }), []);
  assert.deepEqual(resolveStoreAccessPermissions('manager', 'store-a', assignment,
    { ...profile, permissions: ['orders.read', 'orders.read'] }), []);
});
