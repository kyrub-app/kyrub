import assert from 'node:assert/strict';
import test from 'node:test';
import {
  AdminAuthorizationError,
  authorizeAdminIdentity,
  getRolePermissions,
  parseAdminProfileData,
  type AuthenticatedIdentity,
} from '../src/admin/contracts';

const identity: AuthenticatedIdentity = {
  uid: 'admin_support_001',
  email: 'support@example.com',
  emailVerified: true,
};

const profile = {
  uid: identity.uid,
  email: identity.email,
  displayName: 'Equipe de suporte',
  role: 'support',
  status: 'active',
};

test('active verified administrator receives only role permissions', () => {
  const principal = authorizeAdminIdentity(identity, profile, 'read_users');

  assert.equal(principal.uid, identity.uid);
  assert.equal(principal.role, 'support');
  assert.deepEqual(principal.permissions, [
    'read_overview',
    'read_users',
    'read_stores',
  ]);
  assert.equal(principal.permissions.includes('manage_admins'), false);
});

test('unverified identities cannot access privileged backend', () => {
  assert.throws(
    () =>
      authorizeAdminIdentity(
        { ...identity, emailVerified: false },
        profile,
        'read_overview'
      ),
    (error: unknown) =>
      error instanceof AdminAuthorizationError &&
      error.code === 'email-unverified'
  );
});

test('suspended, revoked and missing admin profiles are denied', () => {
  assert.throws(
    () =>
      authorizeAdminIdentity(
        identity,
        { ...profile, status: 'suspended' },
        'read_overview'
      ),
    (error: unknown) =>
      error instanceof AdminAuthorizationError &&
      error.code === 'admin-suspended'
  );

  assert.throws(
    () =>
      authorizeAdminIdentity(
        identity,
        { ...profile, status: 'revoked' },
        'read_overview'
      ),
    (error: unknown) =>
      error instanceof AdminAuthorizationError &&
      error.code === 'admin-revoked'
  );

  assert.throws(
    () => authorizeAdminIdentity(identity, undefined, 'read_overview'),
    (error: unknown) =>
      error instanceof AdminAuthorizationError &&
      error.code === 'admin-record-missing'
  );
});

test('role permission matrix blocks privilege escalation', () => {
  const financeProfile = {
    ...profile,
    role: 'finance',
  };

  assert.throws(
    () =>
      authorizeAdminIdentity(identity, financeProfile, 'manage_admins'),
    (error: unknown) =>
      error instanceof AdminAuthorizationError &&
      error.code === 'permission-denied'
  );
  assert.deepEqual(getRolePermissions('finance'), [
    'read_overview',
    'read_finance',
  ]);
});

test('profile parser rejects mismatched identity and unknown roles', () => {
  assert.equal(parseAdminProfileData(profile, 'another-admin'), null);
  assert.equal(
    parseAdminProfileData({ ...profile, role: 'owner' }, identity.uid),
    null
  );
});
