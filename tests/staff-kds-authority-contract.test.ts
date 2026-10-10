import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { canStoreRoleTransitionOrderStatus } from '../src/utils/storeSecurity';

const server = readFileSync('server/inventory/orderInventoryRouter.ts', 'utf8');
const client = readFileSync('src/utils/orderWorkflow.ts', 'utf8');
const orders = readFileSync('src/utils/customerOrders.ts', 'utf8');
const erp = readFileSync('src/components/RetailerPanel.tsx', 'utf8');
const inbox = readFileSync('src/components/customer/CustomerOrderInbox.tsx', 'utf8');

test('canonical KDS policy prevents cross-role and financial escalation', () => {
  assert.equal(canStoreRoleTransitionOrderStatus('cashier', 'accepted'), true);
  assert.equal(canStoreRoleTransitionOrderStatus('cashier', 'rejected'), true);
  assert.equal(canStoreRoleTransitionOrderStatus('cashier', 'preparing'), false);
  assert.equal(canStoreRoleTransitionOrderStatus('cashier', 'completed'), false);
  assert.equal(canStoreRoleTransitionOrderStatus('cashier', 'cancelled'), false);
  assert.equal(canStoreRoleTransitionOrderStatus('seller', 'accepted'), true);
  assert.equal(canStoreRoleTransitionOrderStatus('seller', 'rejected'), false);
  assert.equal(canStoreRoleTransitionOrderStatus('seller', 'completed'), false);
  assert.equal(canStoreRoleTransitionOrderStatus('production', 'accepted'), false);
  assert.equal(canStoreRoleTransitionOrderStatus('production', 'preparing'), true);
  assert.equal(canStoreRoleTransitionOrderStatus('production', 'ready'), true);
  assert.equal(canStoreRoleTransitionOrderStatus('production', 'completed'), false);
  assert.equal(canStoreRoleTransitionOrderStatus('manager', 'completed'), true);
  assert.equal(canStoreRoleTransitionOrderStatus('owner', 'cancelled'), true);
});

test('KDS backend validates active membership and per-status authority on every staff write', () => {
  assert.match(server, /verifyFirebaseIdToken\(token\)/);
  assert.match(server, /authorizeInPersonOrderOperator\(\{/);
  assert.match(server, /authenticatedUserId: actorId/);
  assert.match(server, /permission: 'orders.read'/);
  assert.match(server, /router\.post\('\/:orderId\/status'/);
  assert.match(server, /authorizeOrderActor\(request, request\.body\?\.storeId\)/);
  assert.match(server, /authority\.isStaff && !canStoreRoleTransitionOrderStatus\(authority\.role, status\)/);
  assert.match(server, /authority\.isStaff && currentProvider === '99food'/);
  assert.match(server, /transitionOrderStatusWithInventory\(/);
  assert.match(server, /STORE_ORDER_ACCESS_FORBIDDEN/);
  assert.doesNotMatch(server, /request\.body\?\.role|request\.body\?\.actorId/);
});

test('KDS server read uses verified store scope and only projects operational order fields', () => {
  assert.match(server, /router\.get\('\/kds'/);
  assert.match(server, /authorizeOrderActor\(request, storeId\)/);
  assert.match(server, /orderCollection\(tenantId\)/);
  assert.match(server, /\.limit\(150\)/);
  assert.match(server, /Object\.fromEntries\(allowed\.map/);
  assert.match(server, /'Cache-Control', 'no-store/);
  assert.doesNotMatch(server, /allow read: if true/);
  assert.match(orders, /export const loadStaffStoreCustomerOrders/);
  assert.match(orders, /user\.getIdToken\(\)/);
  assert.match(orders, /parseCustomerOrder\(item\)/);
});

test('owner KDS keeps Firestore subscription while Staff uses scoped server transport', () => {
  assert.match(erp, /if \(user\.uid !== activeRetailerId\) \{/);
  assert.match(erp, /loadStaffStoreCustomerOrders\(activeRetailerId, user\)/);
  assert.match(erp, /subscribeToStoreCustomerOrders\(/);
  assert.match(erp, /canStoreRoleTransitionOrderStatus\(props\.accessRole, status\)/);
  assert.match(inbox, /actionForOrder\(order\)\.filter/);
  assert.match(inbox, /canChangeStatus\?\.\(action\.status\)/);
  assert.match(inbox, /pickupWaiting && \(canChangeStatus\?\.\('completed'\)/);
  assert.match(client, /storeId: normalizedStoreId,\s*status: nextStatus/);
  assert.match(client, /user\.uid !== normalizedStoreId && isNinetyNineFoodOrderId/);
});
