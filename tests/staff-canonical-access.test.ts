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


const orderInventoryRouter = readFileSync(new URL('../server/inventory/orderInventoryRouter.ts', import.meta.url), 'utf8');
test('order API separates actor identity from selected store and enforces membership permission', () => {
  assert.match(orderWorkflow, /x-kyrub-store-id/);
  assert.match(orderInventoryRouter, /stores\/\$\{canonicalStoreId\}\/members\/\$\{userId\}/);
  assert.match(orderInventoryRouter, /STORE_ACCESS_DENIED/);
  assert.match(orderInventoryRouter, /response\.status\(403\)/);
  assert.match(orderInventoryRouter, /permissionForOrderStatus/);
});


const inPersonOrderRouter = readFileSync(new URL('../server/attendance/inPersonOrderRouter.ts', import.meta.url), 'utf8');
test('PDV authorizes active staff membership by operation permission', () => {
  assert.match(inPersonOrderRouter, /authorizeStoreMember/);
  assert.match(inPersonOrderRouter, /permission: 'orders\.read'/);
  assert.match(inPersonOrderRouter, /permission: 'orders\.create'/);
  assert.match(inPersonOrderRouter, /member\.status !== 'active'/);
  assert.match(inPersonOrderRouter, /hasStorePermission\(member\.role, input\.permission\)/);
});


test('legacy reservations remain restricted until canonical persistence exists', () => {
  assert.match(mobileMenu, /itemId === 'reservas'.*orders\.create/);
});


const timeClockRouter = readFileSync(new URL('../server/staff/timeClockRouter.ts', import.meta.url), 'utf8');
test('canonical time clock binds punches to authenticated active member', () => {
  assert.match(timeClockRouter, /members\/\$\{identity\.uid\}/);
  assert.match(timeClockRouter, /member\.status !== 'active'/);
  assert.match(timeClockRouter, /timeClockEntries/);
  assert.match(timeClockRouter, /userId: actor\.userId/);
  assert.match(timeClockRouter, /FieldValue\.serverTimestamp\(\)/);
  assert.doesNotMatch(timeClockRouter, /request\.body\?\.userId/);
});


test('point UI uses canonical authenticated time clock instead of local-only logs', () => {
  assert.match(legacyRetailerPanel, /\/api\/staff\/time-clock\/me/);
  assert.match(legacyRetailerPanel, /\/api\/staff\/time-clock\/\$\{action\}/);
  assert.match(legacyRetailerPanel, /auth\.currentUser/);
  assert.match(legacyRetailerPanel, /user\.getIdToken\(\)/);
  assert.doesNotMatch(legacyRetailerPanel, /const handleClockIn = \(\) =>/);
});


test('team time clock is manager-only while personal punches remain self-bound', () => {
  assert.match(timeClockRouter, /router\.get\('\/team'/);
  assert.match(timeClockRouter, /actor\.role !== 'owner' && actor\.role !== 'manager'/);
  assert.match(timeClockRouter, /router\.get\('\/me'/);
  assert.match(timeClockRouter, /where\('userId', '==', actor\.userId\)/);
});


test('team workspace reads canonical time clock without creating a second employee identity', () => {
  assert.match(storeTeamWorkspace, /\/api\/staff\/time-clock\/team/);
  assert.match(storeTeamWorkspace, /members\.find\(item => item\.userId === entry\.userId\)/);
  assert.match(storeTeamWorkspace, /user\.getIdToken\(\)/);
  assert.doesNotMatch(storeTeamWorkspace, /timeClock.*displayName.*request/i);
});
