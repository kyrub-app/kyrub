import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { hasStorePermission } from '../src/utils/storeSecurity';

const service = readFileSync('server/attendance/inPersonOrderService.ts', 'utf8');
const orderRouter = readFileSync('server/attendance/inPersonOrderRouter.ts', 'utf8');
const localRouter = readFileSync('server/attendance/localAttendanceRouter.ts', 'utf8');
const erp = readFileSync('src/components/RetailerPanel.tsx', 'utf8');
const composer = readFileSync('src/components/store/InPersonOrderComposer.tsx', 'utf8');
const browser = readFileSync('src/utils/inPersonOrders.ts', 'utf8');

test('only verified active canonical store members with permission can operate PDV orders', () => {
  assert.ok(service.includes('export const authorizeInPersonOrderOperator'));
  assert.ok(service.includes('stores/${context.canonicalStoreId}/members/${actorId}'));
  assert.ok(service.includes('clean(member?.userId) !== actorId'));
  assert.ok(service.includes('clean(member?.storeId) !== context.canonicalStoreId'));
  assert.ok(service.includes("clean(member?.status) !== 'active'"));
  assert.ok(service.includes('!isStoreRole(role)'));
  assert.ok(service.includes('!hasStorePermission(role, input.permission)'));
  assert.ok(service.includes("permission: 'products.read'"));
  assert.ok(service.includes("permission: 'orders.create'"));
  assert.ok(service.includes("throw new Error('IN_PERSON_ORDER_FORBIDDEN')"));
  assert.ok(orderRouter.includes('authenticatedActorId'));
  assert.ok(orderRouter.includes('verified') || orderRouter.includes('verifyFirebaseIdToken'));
  assert.ok(!orderRouter.includes('request.body?.role'));
});

test('staff orders never inherit the owner role or client-supplied price or operator', () => {
  assert.ok(service.includes('createdByRole: context.role'));
  assert.ok(service.includes('originatedByRole: context.role'));
  assert.ok(service.includes('operatorId: actorUserId'));
  assert.ok(service.includes('price: product.price'));
  assert.ok(!service.includes("createdByRole: 'owner'"));
  assert.ok(!service.includes("originatedByRole: 'owner'"));
  assert.ok(browser.includes('currentUser().getIdToken()'));
  assert.ok(!browser.includes('operatorId:'));
});

test('staff can read active locations without gaining location management, fiscal or payment authority', () => {
  const getLocations = localRouter.slice(
    localRouter.indexOf("router.get('/locations'"),
    localRouter.indexOf("router.post('/locations'")
  );
  const mutation = localRouter.slice(localRouter.indexOf("router.post('/locations'"));
  assert.ok(getLocations.includes("const activeOnly = request.query.activeOnly === 'true'"));
  assert.ok(getLocations.includes('authorizeInPersonOrderOperator({'));
  assert.ok(getLocations.includes("permission: 'orders.create'"));
  assert.ok(getLocations.includes('await requireStoreAuthority({'));
  assert.ok(mutation.includes('await requireStoreAuthority({'));
  assert.ok(orderRouter.includes("router.put('/fiscal-consumer-identity'"));
  const fiscalMutation = orderRouter.slice(orderRouter.indexOf("router.put('/fiscal-consumer-identity'"), orderRouter.indexOf("router.post('/'"));
  assert.ok(fiscalMutation.includes('authorizeOwnerStore({'));
  const payments = localRouter.slice(localRouter.indexOf("router.post('/payment-intents'"));
  assert.ok(payments.includes('await requireStoreAuthority({'));
});

test('existing ERP mounts existing composer for authorized staff and keeps the owner unchanged', () => {
  assert.ok(erp.includes('props.accessRole !== \'owner\''));
  assert.ok(erp.includes("canStoreRoleAccessErpMenuItem(props.accessRole, 'clientes')"));
  assert.ok(erp.includes('<InPersonOrderComposer storeId={activeRetailerId} />'));
  assert.ok(!erp.includes('<InPersonOrderComposer storeId={auth.currentUser?.uid} />'));
  assert.ok(composer.includes('loadInPersonOrderCatalog(storeId)'));
  assert.ok(composer.includes('loadServiceLocations(storeId, { activeOnly: true })'));
  assert.equal(hasStorePermission('cashier', 'orders.create'), true);
  assert.equal(hasStorePermission('seller', 'orders.create'), true);
  assert.equal(hasStorePermission('production', 'orders.create'), false);
  assert.equal(hasStorePermission('owner', 'orders.create'), true);
});
