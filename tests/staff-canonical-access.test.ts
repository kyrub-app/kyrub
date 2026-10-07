import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';

const legacyApp = readFileSync(new URL('../src/LegacyApp.tsx', import.meta.url), 'utf8');
const staffViewport = readFileSync(new URL('../src/components/StaffViewport.tsx', import.meta.url), 'utf8');

test('staff route has no shared demo credentials', () => {
  assert.doesNotMatch(legacyApp, /staff@kyrub\.com/);
  assert.doesNotMatch(legacyApp, /kyrub123/);
  assert.doesNotMatch(staffViewport, /staff@kyrub\.com/);
  assert.doesNotMatch(staffViewport, /kyrub123/);
});

test('staff route resolves canonical store memberships', () => {
  assert.match(legacyApp, /subscribeToUserStoreAccess/);
  assert.match(legacyApp, /access\.status === 'active'/);
  assert.match(staffViewport, /STORE_ROLE_LABELS/);
  assert.match(staffViewport, /Sem acesso operacional ativo/);
});

test('staff route does not create a second password login', () => {
  assert.doesNotMatch(staffViewport, /type="password"/);
  assert.doesNotMatch(legacyApp, /setIsStaffLoggedIn/);
});


test('staff access enters the existing ERP and filters its menu by role', () => {
  assert.match(legacyApp, /onEnterErp=/);
  assert.match(legacyApp, /canStoreRoleAccessErpMenuItem/);
  assert.match(staffViewport, /Entrar no ERP/);
});


test('selected staff store becomes the ERP tenant context', () => {
  assert.match(legacyApp, /legacyTenantId/);
});

const canonicalCash = readFileSync(new URL('../src/utils/canonicalCash.ts', import.meta.url), 'utf8');
test('cash mutations enforce role permission inside the action layer', () => {
  assert.match(canonicalCash, /requireCashPermission/);
  assert.match(canonicalCash, /hasStorePermission/);
});


const orderWorkflow = readFileSync(new URL('../src/utils/orderWorkflow.ts', import.meta.url), 'utf8');
const retailerPanel = readFileSync(new URL('../src/components/RetailerPanel.tsx', import.meta.url), 'utf8');
test('staff order workspace no longer requires employee uid to equal store tenant', () => {
  assert.doesNotMatch(orderWorkflow, /user\.uid !== normalizedStoreId/);
  assert.match(orderWorkflow, /Bearer/);
  assert.match(retailerPanel, /subscribeToStoreCustomerOrders/);
});
