import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import {
  getAdminPermissions,
  hasAdminPermission,
  isAdminControlPlaneLocation,
  parseAdminProfile,
} from '../src/utils/adminControlPlane';

const modulesSource = readFileSync(
  'src/components/admin/AdminModulesWorkspace.tsx',
  'utf8'
);
const directorySource = readFileSync(
  'src/components/admin/AdminDirectoryWorkspace.tsx',
  'utf8'
);
const rootSource = readFileSync(
  'src/components/admin/AdminControlPlaneRoot.tsx',
  'utf8'
);
const appSource = readFileSync(
  'src/components/admin/AdminControlPlaneApp.tsx',
  'utf8'
);
const promotionalWorkspaceSource = readFileSync(
  'src/components/admin/AdminPromotionalPlanWorkspace.tsx',
  'utf8'
);
const promotionalServiceSource = readFileSync(
  'server/admin/promotionalPlanService.ts',
  'utf8'
);
const promotionalEndpointSource = readFileSync(
  'api/admin/store-entitlements/promotional-pro.ts',
  'utf8'
);

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
  assert.equal(
    parseAdminProfile({ uid: 'admin_a', role: 'owner', status: 'active' }),
    null
  );
  assert.equal(
    parseAdminProfile(
      { uid: 'admin_a', role: 'support', status: 'active' },
      'admin_b'
    ),
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

test('routes only the administrative hostname, local path, or explicit Vercel preview flag', () => {
  assert.equal(isAdminControlPlaneLocation('admin.kyrub.com', '/'), true);
  assert.equal(isAdminControlPlaneLocation('admin.localhost', '/'), true);
  assert.equal(isAdminControlPlaneLocation('localhost', '/admin'), true);
  assert.equal(isAdminControlPlaneLocation('localhost', '/admin/users'), true);
  assert.equal(isAdminControlPlaneLocation('kyrub.com', '/admin'), false);
  assert.equal(isAdminControlPlaneLocation('kyrub.com', '/'), false);
  assert.equal(
    isAdminControlPlaneLocation(
      'kyrub-preview.vercel.app',
      '/',
      '?kyrub_admin_preview=1'
    ),
    true
  );
  assert.equal(
    isAdminControlPlaneLocation('kyrub-preview.vercel.app', '/', ''),
    false
  );
  assert.equal(
    isAdminControlPlaneLocation('kyrub.com', '/', '?kyrub_admin_preview=1'),
    false
  );
});

test('groups active and future control plane modules for mobile', () => {
  assert.match(modulesSource, /Áreas do Control Plane/);
  assert.match(modulesSource, /Saúde do sistema/);
  assert.match(modulesSource, /status: 'available'/);
  assert.match(modulesSource, /Recursos em preparação/);
  assert.match(modulesSource, /<details/);
  assert.match(modulesSource, /admin-directory/);
  assert.match(modulesSource, /admin-system-health/);
  assert.match(rootSource, /id="admin-system-health"/);
});

test('directory exposes explicit searching, empty and error feedback', () => {
  assert.match(directorySource, /id="admin-directory"/);
  assert.match(directorySource, /aria-busy=\{busy\}/);
  assert.match(directorySource, /Consultando o diretório/);
  assert.match(directorySource, /Nenhuma conta encontrada/);
  assert.match(directorySource, /A consulta não foi concluída/);
  assert.match(directorySource, /A busca é exata/);
  assert.match(directorySource, /aria-live="polite"/);
});

test('founding Pro courtesy is a fixed super-admin promotional entitlement with authoritative audit', () => {
  assert.match(appSource, /profile\.role === 'super_admin'/);
  assert.match(appSource, /AdminPromotionalPlanWorkspace/);
  assert.match(promotionalWorkspaceSource, /founding_pro_001/);
  assert.match(promotionalWorkspaceSource, /Conceder Pro cortesia/);
  assert.match(promotionalWorkspaceSource, /window\.confirm/);

  assert.match(promotionalServiceSource, /FOUNDING_PRO_PROMOTION_ID = 'founding_pro_001'/);
  assert.match(promotionalServiceSource, /admin\.role !== 'super_admin'/);
  assert.match(promotionalServiceSource, /plan: 'pro'/);
  assert.match(promotionalServiceSource, /source: 'promotional'/);
  assert.match(promotionalServiceSource, /benefitType: 'complimentary'/);
  assert.match(promotionalServiceSource, /expiresAt: null/);
  assert.match(promotionalServiceSource, /admin\.store_plan\.promotional_pro\.granted/);
  assert.match(promotionalServiceSource, /kyrub_admin\/control_plane\/store_entitlements/);
  assert.doesNotMatch(promotionalServiceSource, /checkout|subscription|payment/i);

  assert.match(promotionalEndpointSource, /toUpperCase\(\) !== 'POST'/);
  assert.match(promotionalEndpointSource, /grantFoundingProPromotion/);
});
