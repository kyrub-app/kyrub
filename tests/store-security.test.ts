import assert from 'node:assert/strict';
import test from 'node:test';
import {
  STORE_ROLE_DISCOUNT_LIMITS,
  STORE_ROLE_LABELS,
  canApplyStoreDiscount,
  canAssignStoreRole,
  canManageStoreRole,
  getCancellationAuthority,
  getStoreAuditLogsCollectionPath,
  getStoreCashSessionsCollectionPath,
  getStoreMemberDocumentPath,
  getStoreOrderDocumentPath,
  getStorePaymentsCollectionPath,
  hasStorePermission,
  parseStoreMember,
} from '../src/utils/storeSecurity';

test('uses Vendedor as the broad customer-facing role label', () => {
  assert.equal(STORE_ROLE_LABELS.seller, 'Vendedor');
  assert.equal(STORE_ROLE_LABELS.production, 'Produção');
});

test('allows sellers to operate orders and receive payments without managing cash', () => {
  assert.equal(hasStorePermission('seller', 'orders.create'), true);
  assert.equal(hasStorePermission('seller', 'orders.transfer'), true);
  assert.equal(hasStorePermission('seller', 'payments.create'), true);
  assert.equal(hasStorePermission('seller', 'cash.manage'), false);
  assert.equal(hasStorePermission('seller', 'payments.refund'), false);
});

test('keeps production away from financial operations', () => {
  assert.equal(hasStorePermission('production', 'production.update'), true);
  assert.equal(hasStorePermission('production', 'payments.create'), false);
  assert.equal(hasStorePermission('production', 'cash.read'), false);
});

test('enforces the approved staff management hierarchy', () => {
  assert.equal(canManageStoreRole('owner', 'manager'), true);
  assert.equal(canManageStoreRole('owner', 'owner'), false);
  assert.equal(canManageStoreRole('manager', 'seller'), true);
  assert.equal(canManageStoreRole('manager', 'cashier'), true);
  assert.equal(canManageStoreRole('manager', 'production'), true);
  assert.equal(canManageStoreRole('manager', 'manager'), false);
  assert.equal(canAssignStoreRole('seller', 'production'), false);
});

test('applies the approved role discount limits', () => {
  assert.equal(STORE_ROLE_DISCOUNT_LIMITS.owner, null);
  assert.equal(STORE_ROLE_DISCOUNT_LIMITS.manager, 20);
  assert.equal(STORE_ROLE_DISCOUNT_LIMITS.cashier, 10);
  assert.equal(STORE_ROLE_DISCOUNT_LIMITS.seller, 5);
  assert.equal(STORE_ROLE_DISCOUNT_LIMITS.production, 0);
  assert.equal(canApplyStoreDiscount('seller', 5), true);
  assert.equal(canApplyStoreDiscount('seller', 5.01), false);
  assert.equal(canApplyStoreDiscount('owner', 99), true);
  assert.equal(canApplyStoreDiscount('cashier', -1), false);
});

test('requires seller approval after an item reaches production', () => {
  assert.equal(getCancellationAuthority('seller', false), 'direct');
  assert.equal(getCancellationAuthority('seller', true), 'request');
  assert.equal(getCancellationAuthority('production', true), 'request');
  assert.equal(getCancellationAuthority('cashier', true), 'direct');
  assert.equal(getCancellationAuthority('manager', true), 'direct');
});

test('parses store memberships without mixing stores or users', () => {
  const member = parseStoreMember({
    storeId: 'store-a',
    userId: 'user-a',
    role: 'seller',
    status: 'active',
    invitedBy: 'owner-a',
    invitedAt: '2026-07-21T00:00:00.000Z',
    acceptedAt: '2026-07-21T00:01:00.000Z',
    suspendedAt: '',
    removedAt: '',
    createdAt: '2026-07-21T00:00:00.000Z',
    updatedAt: '2026-07-21T00:01:00.000Z',
  });

  assert.equal(member?.storeId, 'store-a');
  assert.equal(member?.userId, 'user-a');
  assert.equal(member?.role, 'seller');
  assert.equal(parseStoreMember({ storeId: 'store-a', role: 'seller' }), null);
  assert.equal(
    parseStoreMember({
      storeId: 'store-a',
      userId: 'user-a',
      role: 'administrator',
      status: 'active',
    }),
    null
  );
});

test('builds canonical paths from an independent store id', () => {
  assert.equal(
    getStoreMemberDocumentPath('store-a', 'seller-a'),
    'stores/store-a/members/seller-a'
  );
  assert.equal(
    getStoreOrderDocumentPath('store-a', 'order-a'),
    'stores/store-a/orders/order-a'
  );
  assert.equal(
    getStorePaymentsCollectionPath('store-a'),
    'stores/store-a/payments'
  );
  assert.equal(
    getStoreCashSessionsCollectionPath('store-a'),
    'stores/store-a/cashSessions'
  );
  assert.equal(
    getStoreAuditLogsCollectionPath('store-a'),
    'stores/store-a/auditLogs'
  );
});
