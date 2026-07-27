import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { describe, test } from 'node:test';
import { hasAdminPermission, type AdminProfile } from '../src/utils/adminControlPlane';
import { parseAdminOperationsHealth } from '../src/utils/adminOperationsHealth';

const serverSource = readFileSync(
  'server/admin/operationsHealthRouter.ts',
  'utf8'
);
const appSource = readFileSync('src/App.tsx', 'utf8');
const workspaceSource = readFileSync(
  'src/components/admin/AdminSystemHealthWorkspace.tsx',
  'utf8'
);
const serverEntrySource = readFileSync('server.ts', 'utf8');

const profile = (role: AdminProfile['role']): AdminProfile => ({
  uid: 'admin-a',
  email: 'admin@example.com',
  displayName: 'Admin',
  role,
  status: 'active',
  createdBy: 'bootstrap',
  createdAt: '',
  updatedAt: '',
  suspendedAt: '',
  revokedAt: '',
});

describe('admin operations health', () => {
  test('only operations and super admin roles have system health permission', () => {
    assert.equal(hasAdminPermission(profile('operations'), 'read_system_health'), true);
    assert.equal(hasAdminPermission(profile('super_admin'), 'read_system_health'), true);
    assert.equal(hasAdminPermission(profile('support'), 'read_system_health'), false);
    assert.equal(hasAdminPermission(profile('finance'), 'read_system_health'), false);
  });

  test('parses only aggregate counters and clamps malformed values', () => {
    const parsed = parseAdminOperationsHealth({
      generatedAt: '2026-07-27T12:00:00.000Z',
      state: 'attention',
      integration: {
        queued: 4,
        processing: 2,
        failed: -1,
        connected: 3,
        attention: 'invalid',
      },
      delivery: {
        available: 5,
        accepted: 2,
        delivering: 1,
        waitingFallback: 3,
        providerEscalations: 1,
      },
      payload: { customerName: 'must not be parsed' },
    });

    assert.ok(parsed);
    assert.equal(parsed.state, 'attention');
    assert.equal(parsed.integration.queued, 4);
    assert.equal(parsed.integration.failed, 0);
    assert.equal(parsed.integration.attention, 0);
    assert.equal('payload' in parsed, false);
  });

  test('server validates token, verified email and authoritative admin profile', () => {
    assert.match(serverSource, /verifyIdToken\(token, true\)/);
    assert.match(serverSource, /email_verified !== true/);
    assert.match(serverSource, /kyrub_admin\/control_plane\/admins/);
    assert.match(serverSource, /status\) !== 'active'/);
    assert.match(serverSource, /SYSTEM_HEALTH_ROLES/);
    assert.match(serverSource, /admin\.system_health\.viewed/);
  });

  test('health response counts queues without returning documents or secrets', () => {
    assert.match(serverSource, /\.count\(\)\.get\(\)/);
    assert.match(serverSource, /integrationIngress/);
    assert.match(serverSource, /integrationConnections/);
    assert.match(serverSource, /deliveryEscalationQueue/);
    assert.match(serverSource, /adminLogisticsEscalations/);
    assert.doesNotMatch(serverSource, /encryptedCredentials:/);
    assert.doesNotMatch(serverSource, /rawBodyBase64:/);
    assert.doesNotMatch(serverSource, /customerName:/);
  });

  test('control plane mounts a read-only auto-refreshing health workspace', () => {
    assert.match(appSource, /AdminControlPlaneRoot/);
    assert.match(workspaceSource, /read_system_health/);
    assert.match(workspaceSource, /loadAdminOperationsHealth/);
    assert.match(workspaceSource, /60_000/);
    assert.match(workspaceSource, /Nenhum payload, cliente ou segredo é exposto/);
    assert.match(serverEntrySource, /api\/admin\/operations\/health/);
  });
});
