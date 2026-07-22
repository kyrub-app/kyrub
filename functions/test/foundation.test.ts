import assert from 'node:assert/strict';
import test from 'node:test';
import { buildAdminBackendAuditData } from '../src/admin/audit';
import { calculateRateLimitDecision } from '../src/admin/rateLimit';
import {
  InvalidAdminRequestError,
  isSafeOperationIdentifier,
  parseAdminStatusRequest,
} from '../src/admin/request';
import { toAdminHttpsError } from '../src/admin/errors';

const principal = {
  uid: 'admin_super_001',
  email: 'admin@example.com',
  displayName: 'Admin',
  role: 'super_admin' as const,
  status: 'active' as const,
  permissions: [
    'read_overview',
    'read_users',
    'read_stores',
    'read_system_health',
    'read_finance',
    'read_audit',
    'manage_admins',
    'manage_features',
    'manage_compliance',
  ] as const,
};

test('request identifiers are strict and normalized', () => {
  assert.equal(isSafeOperationIdentifier('request_1234567890'), true);
  assert.equal(isSafeOperationIdentifier('short'), false);
  assert.equal(isSafeOperationIdentifier('invalid request id'), false);
  assert.deepEqual(
    parseAdminStatusRequest({ requestId: '  request_1234567890  ' }),
    { requestId: 'request_1234567890' }
  );
  assert.throws(
    () => parseAdminStatusRequest({ requestId: 'short' }),
    InvalidAdminRequestError
  );
});

test('rate limit decision respects the configured maximum', () => {
  assert.deepEqual(calculateRateLimitDecision(0, 3), {
    allowed: true,
    nextCount: 1,
    remaining: 2,
  });
  assert.deepEqual(calculateRateLimitDecision(2, 3), {
    allowed: true,
    nextCount: 3,
    remaining: 0,
  });
  assert.deepEqual(calculateRateLimitDecision(3, 3), {
    allowed: false,
    nextCount: 3,
    remaining: 0,
  });
});

test('authoritative audit binds actor, action and request id', () => {
  const data = buildAdminBackendAuditData({
    requestId: 'request_1234567890',
    action: 'admin.backend.status.checked',
    actor: principal,
    targetType: 'control_plane',
    targetId: 'admin_backend',
    outcome: 'success',
  });

  assert.equal(data.id, 'backend_request_1234567890');
  assert.equal(data.actorId, principal.uid);
  assert.equal(data.actorRole, principal.role);
  assert.equal(data.source, 'backend');
  assert.equal(data.action, 'admin.backend.status.checked');
  assert.ok(data.createdAt);
});

test('invalid callable payload maps to invalid-argument', () => {
  const mapped = toAdminHttpsError(
    new InvalidAdminRequestError('requestId inválido.')
  );
  assert.equal(mapped.code, 'invalid-argument');
});
