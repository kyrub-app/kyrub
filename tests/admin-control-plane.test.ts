import assert from 'node:assert/strict';
import test from 'node:test';
import {
  getAdminPermissions,
  hasAdminPermission,
  isAdminControlPlaneLocation,
  parseAdminProfile,
} from '../src/utils/adminControlPlane';

test('parses only known administrative roles and matching identities', () => {
  const profile = parseAdminProfile(
    {
      uid: 'admin_a',
      email: 'admin@example.com',
      displayName: 'Admin A',
      role: 'operations',
      status: 'active',
      createdBy: 'bootstrap',
      createdAt: '2026-07-22T00:00:00.000Z',
      updatedAt: '2026-07-22T00:00:00.000Z',
      suspendedAt: '',
      revokedAt: '',
    },
    'admin_a'
  );

  assert.equal(profile?.role, 'operations');
  assert.equal(profile?.status, 'active');
  assert.equal(parseAdminProfile({ uid: 'admin_a', role: 'owner', status: 'active' }), null);
  assert.equal(
    parseAdminProfile({ uid: 'admin_a', role: 'support', status: 'active' }, 'admin_b'),
    null
  );
});

test('derives permissions from role and blocks suspended profiles', () => {
  const operations = {
    role: 'operations' as const,
    status: 'active' as const,
  };
  assert.equal(hasAdminPermission(operations, 'read_system_health'), true);
  assert.equal(hasAdminPermission(operations, 'read_finance'), false);
  assert.equal(
    hasAdminPermission({ ...operations, status: 'suspended' }, 'read_users'),
    false
  );

  const superPermissions = getAdminPermissions('super_admin');
  assert.equal(superPermissions.includes('manage_admins'), true);
  assert.equal(superPermissions.includes('manage_compliance'), true);
});

test('routes only the administrative hostname and explicit local development path', () => {
  assert.equal(isAdminControlPlaneLocation('admin.kyrub.com', '/'), true);
  assert.equal(isAdminControlPlaneLocation('admin.localhost', '/'), true);
  assert.equal(isAdminControlPlaneLocation('localhost', '/admin'), true);
  assert.equal(isAdminControlPlaneLocation('localhost', '/admin/users'), true);
  assert.equal(isAdminControlPlaneLocation('kyrub.com', '/admin'), false);
  assert.equal(isAdminControlPlaneLocation('kyrub.com', '/'), false);
});
