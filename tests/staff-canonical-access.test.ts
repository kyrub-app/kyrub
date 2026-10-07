import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';

const legacyApp = readFileSync(new URL('../src/LegacyApp.tsx', import.meta.url), 'utf8');
const staffViewport = readFileSync(new URL('../src/components/StaffViewport.tsx', import.meta.url), 'utf8');
const mobileMenu = readFileSync(new URL('../src/components/MobileErpMenu.tsx', import.meta.url), 'utf8');
const legacyRetailerPanel = readFileSync(new URL('../src/components/LegacyRetailerPanel.tsx', import.meta.url), 'utf8');
const storeTeamWorkspace = readFileSync(new URL('../src/components/store/StoreTeamWorkspace.tsx', import.meta.url), 'utf8');

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
const promotionsLegacyBridge = readFileSync(new URL('../src/components/store/StorePromotionsLegacyBridge.tsx', import.meta.url), 'utf8');
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


test('reservations UI uses canonical authenticated API instead of local-only mutations', () => {
  assert.match(legacyRetailerPanel, /\/api\/staff\/reservations\?storeId=/);
  assert.match(legacyRetailerPanel, /fetch\('\/api\/staff\/reservations'/);
  assert.match(legacyRetailerPanel, /\/complete/);
  assert.match(legacyRetailerPanel, /user\.getIdToken\(\)/);
  assert.doesNotMatch(legacyRetailerPanel, /res-\$\{Math\.floor\(Math\.random/);
  assert.doesNotMatch(legacyRetailerPanel, /setReservations\(\[newRes,/);
});


test('selected staff store context does not reuse the authenticated user store', () => {
  assert.match(legacyApp, /if \(selectedStaffAccess\)/);
  assert.match(legacyApp, /stores\.find\(store => store\.id === legacyStoreId\)/);
  assert.match(legacyApp, /name: selectedStaffAccess\.store\.name/);
  assert.match(legacyApp, /Staff store profile mutation is not allowed/);
});

test('authorized staff order navigation is not restricted to owner uid equality', () => {
  assert.doesNotMatch(retailerPanel, /user\.uid !== activeRetailerId/);
  assert.match(retailerPanel, /detail\?\.storeId\?\.trim\(\) !== activeRetailerId/);
});


test('adjacent order routes stay owner scoped while status supports selected staff store', () => {
  assert.match(orderInventoryRouter, /provider-sync\/99food\/pending[\s\S]*?const tenantId = userId;/);
  assert.match(orderInventoryRouter, /provider-sync\/99food'[\s\S]*?const tenantId = userId;/);
  assert.match(orderInventoryRouter, /reconcile-inventory'[\s\S]*?const tenantId = userId;/);
  assert.match(orderInventoryRouter, /attendance-review'[\s\S]*?const tenantId = userId;/);
  assert.match(orderInventoryRouter, /\/:orderId\/status'[\s\S]*?x-kyrub-store-id/);
});

const inPersonOrderService = readFileSync(new URL('../server/attendance/inPersonOrderService.ts', import.meta.url), 'utf8');
test('PDV service separates authenticated operator from authorized store context', () => {
  assert.match(inPersonOrderRouter, /authorizedStoreId: storeId/);
  assert.match(inPersonOrderService, /authorizedStoreId\?: string/);
  assert.match(inPersonOrderService, /authorizedStoreId !== request\.storeId/);
  assert.doesNotMatch(inPersonOrderService, /actorUserId !== request\.storeId/);
  assert.match(inPersonOrderService, /operatorId: actorUserId/);
});

test('customer attendance no longer keeps a parallel local ticket workflow', () => {
  assert.doesNotMatch(legacyRetailerPanel, /kyrub_legacy_active_tickets_/);
  assert.doesNotMatch(legacyRetailerPanel, /activeTickets/);
  assert.doesNotMatch(legacyRetailerPanel, /handleOpenTicket/);
  assert.doesNotMatch(legacyRetailerPanel, /handleCheckoutTicket/);
  assert.doesNotMatch(legacyRetailerPanel, /TCK-\$\{Math\.floor/);
  assert.match(retailerPanel, /CustomerTableBoard/);
  assert.match(retailerPanel, /TableServiceWorkspace/);
  assert.match(retailerPanel, /AttendanceOrderApproval/);
});

test('cash tab no longer keeps the superseded Dexie simulation behind canonical CashWorkspace', () => {
  assert.doesNotMatch(legacyRetailerPanel, /DexieERPDB/);
  assert.doesNotMatch(legacyRetailerPanel, /erpDB\.movements/);
  assert.doesNotMatch(legacyRetailerPanel, /handleSyncFirestore/);
  assert.doesNotMatch(legacyRetailerPanel, /Sincronizar Dexie/);
  assert.match(legacyRetailerPanel, /id="erp-caixa-tab"/);
  assert.match(retailerPanel, /CashWorkspace/);
  assert.match(canonicalCash, /requireCashPermission\(context, 'cash\.manage'\)/);
});

test('manager workspace does not present fictitious sales or fake webhook success', () => {
  assert.doesNotMatch(legacyRetailerPanel, /R\$ 1\.842,90/);
  assert.doesNotMatch(legacyRetailerPanel, /R\$ 153,50/);
  assert.doesNotMatch(legacyRetailerPanel, /12 un/);
  assert.doesNotMatch(legacyRetailerPanel, /92 %/);
  assert.doesNotMatch(legacyRetailerPanel, /Simulação de Payload recebido/);
  assert.doesNotMatch(legacyRetailerPanel, /Disparar Payload Webhook/);
  assert.match(legacyRetailerPanel, /Nenhum indicador demonstrativo é exibido/);
  assert.match(legacyRetailerPanel, /Este painel não gera pedidos simulados/);
});

test('canonical promotions bind to the selected owner store without impersonating staff', () => {
  assert.match(retailerPanel, /auth\.currentUser\?\.uid === activeRetailerId/);
  assert.match(retailerPanel, /<StorePromotionsLegacyBridge/);
  assert.match(retailerPanel, /storeId=\{activeRetailerId\}/);
  assert.match(retailerPanel, /products=\{activeRetailerProducts\}/);
  assert.match(promotionsLegacyBridge, /storeId=\{storeId\}/);
  assert.match(promotionsLegacyBridge, /products=\{products\}/);
  assert.doesNotMatch(promotionsLegacyBridge, /storeId=\{user\.uid\}/);
});

test('voucher workspace has one canonical authority and a stable host', () => {
  assert.match(legacyRetailerPanel, /id="kyrub-store-promotions-legacy-anchor"/);
  assert.doesNotMatch(legacyRetailerPanel, /const \[vouchers, setVouchers\]/);
  assert.doesNotMatch(legacyRetailerPanel, /newVoucherCode/);
  assert.doesNotMatch(legacyRetailerPanel, /Ativar Cupom Promocional/);
  assert.doesNotMatch(legacyRetailerPanel, /ativado com sucesso!/);
  assert.match(promotionsLegacyBridge, /findLegacyVoucherAnchor/);
  assert.match(promotionsLegacyBridge, /kyrub-store-promotions-legacy-anchor/);
  assert.doesNotMatch(promotionsLegacyBridge, /CRIAR NOVO CUPOM/);
});
