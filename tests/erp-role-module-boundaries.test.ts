import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFileSync } from 'node:fs';
import { canStoreRoleAccessErpMenuItem } from '../src/components/MobileErpMenu';

test('administrative RH and finance workspaces are not exposed to operational roles', () => {
  for (const role of ['cashier', 'seller', 'production'] as const) {
    assert.equal(canStoreRoleAccessErpMenuItem(role, 'rh'), false);
    assert.equal(canStoreRoleAccessErpMenuItem(role, 'financeiro'), false);
    assert.equal(canStoreRoleAccessErpMenuItem(role, 'crm'), false);
    assert.equal(canStoreRoleAccessErpMenuItem(role, 'vendas'), role === 'cashier');
  }
});

test('manager retains management access while owner retains all menu access', () => {
  for (const role of ['owner', 'manager'] as const) {
    for (const module of ['rh', 'financeiro', 'crm', 'vendas'] as const) {
      assert.equal(canStoreRoleAccessErpMenuItem(role, module), true);
    }
  }
});

test('operational roles retain authorized PDV and production destinations', () => {
  assert.equal(canStoreRoleAccessErpMenuItem('cashier', 'caixa'), true);
  assert.equal(canStoreRoleAccessErpMenuItem('seller', 'clientes'), true);
  assert.equal(canStoreRoleAccessErpMenuItem('production', 'pedidos'), true);
  assert.equal(canStoreRoleAccessErpMenuItem('production', 'caixa'), false);
});


test('staff ERP keeps live membership subscribed after leaving /staff and closes from both viewports', () => {
  const app = readFileSync('src/LegacyApp.tsx', 'utf8');
  assert.match(app, /currentPath\.endsWith\('\/staff'\) \|\| staffErpSession/);
  assert.match(app, /\[authenticatedUserId, currentPath, staffErpSession\]/);
  assert.match(app, /setStaffErpSession\(true\)/);
  assert.match(app, /onClosePanel=\{\(\) => \{ setIsGestaoOpen\(false\); setStaffErpSession\(false\); \}\}/);
  assert.match(app, /onClick=\{\(\) => \{ setIsGestaoOpen\(false\); setStaffErpSession\(false\); \}\}/);
  assert.match(app, /isGestaoOpen && !\(gestaoRole === 'retailer' && !erpAccessRole\)/);
});
