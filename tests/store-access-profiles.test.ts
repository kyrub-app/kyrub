import assert from 'node:assert/strict';
import test from 'node:test';
import { STORE_ACCESS_PROFILE_TEMPLATES, createStoreAccessProfileFromTemplate, getEditableStoreProfilePermissions, hasStoreAccessPermission, isValidStoreAccessProfile, resolveStoreAccessPermissions, type StoreAccessProfile } from '../src/utils/storeAccessProfiles';
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

test('all starter templates are valid, store-scoped, and exclude owner', () => {
  for (const template of STORE_ACCESS_PROFILE_TEMPLATES) {
    assert.notEqual(template.baseRole, 'owner');
    const created = createStoreAccessProfileFromTemplate('store-a', template);
    assert.equal(isValidStoreAccessProfile(created), true, template.id);
    assert.equal(created.storeId, 'store-a');
  }
});

test('template creation returns an editable copy without mutating the template', () => {
  const template = STORE_ACCESS_PROFILE_TEMPLATES[0];
  const created = createStoreAccessProfileFromTemplate('store-a', template, 'custom-manager');
  assert.equal(created.id, 'custom-manager');
  assert.notEqual(created.permissions, template.permissions);
});

test('editable catalog offers more than template defaults without owner-only powers', () => {
  const template = STORE_ACCESS_PROFILE_TEMPLATES.find(item => item.id === 'lider-turno');
  assert.ok(template);
  const options = getEditableStoreProfilePermissions(template.baseRole);
  assert.ok(options.includes('products.write'));
  assert.ok(!template.permissions.includes('products.write'));
  for (const forbidden of ['ownership.transfer', 'store.update', 'store.publish', 'members.assign_manager']) {
    assert.ok(!options.includes(forbidden as never));
  }
  assert.deepEqual(getEditableStoreProfilePermissions('owner'), []);
});
