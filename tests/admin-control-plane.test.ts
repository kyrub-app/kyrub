import assert from 'node:assert/strict';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import test from 'node:test';
import { join } from 'node:path';
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
const accordionSource = readFileSync(
  'src/components/admin/AdminAccordionSection.tsx',
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
const plansWorkspaceSource = readFileSync(
  'src/components/store/OfficialStoreCommercialWorkspace.tsx',
  'utf8'
);
const promotionalDirectSource = readFileSync(
  'src/components/store/PromotionalDirectRuntime.tsx',
  'utf8'
);
const officialIdentityPanelSource = readFileSync(
  'src/components/store/OfficialStoreIdentityPanel.tsx',
  'utf8'
);
const retailerRouterSource = readFileSync(
  'src/components/RetailerPanelRuntimeRouter.tsx',
  'utf8'
);
const planManagementSource = readFileSync(
  'server/admin/planManagementService.ts',
  'utf8'
);
const entitlementSource = readFileSync(
  'server/admin/storeEntitlementService.ts',
  'utf8'
);
const entitlementLifecycleSource = readFileSync(
  'server/admin/storeEntitlementLifecycleService.ts',
  'utf8'
);
const entitlementBridgeSource = readFileSync(
  'src/components/store/StoreEntitlementLifecycleBridge.tsx',
  'utf8'
);
const executableCatalogSource = readFileSync(
  'server/admin/executablePlanCatalogService.ts',
  'utf8'
);
const publicCatalogSource = readFileSync(
  'server/admin/publicPlanCatalogService.ts',
  'utf8'
);
const commercialPlanSource = readFileSync(
  'shared/kyrubCommercialPlans.ts',
  'utf8'
);
const activePlanClientSource = readFileSync(
  'src/utils/activePlanCatalog.ts',
  'utf8'
);
const activePlanKnowledgeSource = readFileSync(
  'src/ai/activePlanKnowledgeRuntime.ts',
  'utf8'
);
const consultantPlansSource = readFileSync(
  'src/ai/consultantClientWithPlans.ts',
  'utf8'
);
const actionExecuteSource = readFileSync('api/action-execute.ts', 'utf8');
const planGatewaySource = readFileSync('api/plan-control.ts', 'utf8');
const promotionalServiceSource = readFileSync(
  'server/admin/promotionalPlanService.ts',
  'utf8'
);
const adminOperationsSource = readFileSync(
  'api/admin/operations/health.ts',
  'utf8'
);
const vercelConfigSource = readFileSync('vercel.json', 'utf8');

const collectApiFunctions = (directory: string): string[] =>
  readdirSync(directory).flatMap(name => {
    const path = join(directory, name);
    return statSync(path).isDirectory()
      ? collectApiFunctions(path)
      : path.endsWith('.ts')
        ? [path]
        : [];
  });

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

test('keeps the control plane focused on platform governance instead of Cairubi commerce', () => {
  assert.match(modulesSource, /Pessoas & Tenants/);
  assert.match(modulesSource, /Financeiro da Plataforma/);
  assert.match(modulesSource, /Financeiro da Plataforma & BaaS/);
  assert.match(modulesSource, /Operações & Infraestrutura/);
  assert.match(modulesSource, /Governança & IA/);
  assert.match(modulesSource, /Saúde do sistema/);
  assert.match(modulesSource, /status: 'available'/);
  assert.doesNotMatch(modulesSource, /Planos & Cupons/);
  assert.doesNotMatch(modulesSource, /admin-plans-coupons/);
  assert.doesNotMatch(modulesSource, /Comercial & Financeiro/);
  assert.match(modulesSource, /Loja Oficial/);
  assert.match(modulesSource, /Em preparação/);
  assert.match(modulesSource, /AdminAccordionSection/);
  assert.match(accordionSource, /<details/);
  assert.match(accordionSource, /<summary/);
  assert.match(modulesSource, /AdminAiOperationsDashboard/);
  assert.match(modulesSource, /admin-directory/);
  assert.match(modulesSource, /admin-system-health/);
  assert.match(rootSource, /id="admin-system-health"/);
  assert.doesNotMatch(appSource, /AdminPromotionalPlanWorkspace/);
  assert.match(appSource, /comércio da própria Cairubi é administrado pela Loja Oficial/);
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

"+"