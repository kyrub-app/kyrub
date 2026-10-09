import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { canStoreRoleAccessErpMenuItem } from '../src/components/MobileErpMenu';

const app = readFileSync('src/LegacyApp.tsx', 'utf8');
const staff = readFileSync('src/components/StaffViewport.tsx', 'utf8');
const menu = readFileSync('src/components/MobileErpMenu.tsx', 'utf8');
const mobileRuntime = readFileSync('src/components/MobileErpMenuRuntime.tsx', 'utf8');
const router = readFileSync('src/components/RetailerPanelRuntimeRouter.tsx', 'utf8');
const header = readFileSync('src/components/AppHeader.tsx', 'utf8');

test('staff route has one authenticated membership authority and no demonstration passwords', () => {
  assert.doesNotMatch(app + staff, /staff@kyrub\.com|kyrub123|setIsStaffLoggedIn|handleStaffLogin/);
  assert.doesNotMatch(staff, /type="password"/);
  assert.match(app, /subscribeToUserStoreAccess/);
  assert.match(app, /access\.status === 'active'/);
  assert.match(staff, /StoreAccessRecord/);
  assert.match(staff, /Sem acesso operacional ativo/);
  assert.match(staff, /Entrar no ERP/);
  assert.match(app, /routeStaffAccess\.store\.id/);
  assert.match(app, /legacyTenantId/);
  assert.match(app, /onEnterErp=/);
  assert.doesNotMatch(staff, /staffOrders|staffProducts/);
});

test('staff session is live, revoked roles fail closed and logout cannot retain operational access', () => {
  assert.match(app, /currentPath\.endsWith\('\/staff'\) \|\| staffErpSession/);
  assert.match(app, /\[authenticatedUserId, currentPath, staffErpSession\]/);
  assert.match(app, /selectedStaffAccess && authenticatedUserId && selectedStaffAccess\.status === 'active'/);
  assert.match(app, /setStaffErpSession\(false\);\s*setIsGestaoOpen\(false\);/);
  assert.match(app, /selectedStaffStoreId\s*\?\s*selectedStaffAccess\?\.role/);
  assert.match(app, /staffAccessLoading \|\| staffAccessError/);
  assert.match(app, /authenticatedUserId && userStore \? 'owner' : undefined/);
  assert.match(app, /isGestaoOpen && !\(gestaoRole === 'retailer' && !erpAccessRole\)/);
  assert.match(app, /onClosePanel=\{\(\) => \{ setIsGestaoOpen\(false\); setStaffErpSession\(false\); \}\}/);
});

test('desktop, mobile and management runtime all enforce the shared role decision', () => {
  assert.match(app, /MOBILE_ERP_MENU_ITEMS\.filter\(item => erpAccessRole && canStoreRoleAccessErpMenuItem\(erpAccessRole, item\.id\)\)/);
  assert.match(app, /commitMobileErpMenuSelection\(item\.id/);
  assert.match(app, /accessRole=\{erpAccessRole\}/);
  assert.match(menu, /MOBILE_ERP_MENU_ITEMS\.filter\(item => item\.section === section && \(accessRole && canStoreRoleAccessErpMenuItem/);
  assert.match(mobileRuntime, /accessRole && canStoreRoleAccessErpMenuItem/);
  assert.match(router, /!props\.accessRole \|\| !canStoreRoleAccessErpMenuItem/);
  assert.match(router, /managementModule && \(props\.accessRole && canStoreRoleAccessErpMenuItem/);
  assert.match(header, /id="app-header"/);
  assert.match(app, /<AppHeader/);
  assert.doesNotMatch(app, /id="app-header"/);
});

test('store staff roles have only their authorized ERP surfaces', () => {
  for (const role of ['cashier', 'seller', 'production'] as const) {
    for (const module of ['rh', 'financeiro', 'crm', 'fiscal', 'integracoes'] as const) {
      assert.equal(canStoreRoleAccessErpMenuItem(role, module), false, role + ': ' + module);
    }
  }
  assert.equal(canStoreRoleAccessErpMenuItem('cashier', 'caixa'), true);
  assert.equal(canStoreRoleAccessErpMenuItem('seller', 'clientes'), true);
  assert.equal(canStoreRoleAccessErpMenuItem('production', 'pedidos'), true);
  assert.equal(canStoreRoleAccessErpMenuItem('production', 'caixa'), false);
  assert.equal(canStoreRoleAccessErpMenuItem('manager', 'rh'), true);
  assert.equal(canStoreRoleAccessErpMenuItem('manager', 'financeiro'), true);
  assert.equal(canStoreRoleAccessErpMenuItem('owner', 'loja'), true);
});
