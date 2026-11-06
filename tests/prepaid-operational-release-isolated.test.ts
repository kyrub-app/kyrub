import { orderReleaseFixture } from './helpers/orderReleaseFixture';
import assert from 'node:assert/strict';
import test, { beforeEach } from 'node:test';
import { build } from 'esbuild';
import { isPrepaidOrderReleased } from '../shared/orderReleasePolicy';

// Only persistence is substituted. The real settlement, payment normalizers and
// release policy execute unchanged. Transactions reject reads after writes.
const records = new Map<string, any>();
const orderPath = 'artifacts/seller/public/data/customerOrders/order';
const intentPath = 'stores/seller/paymentIntents/intent';
const paymentPath = 'stores/seller/payments/payment';
const receiptPath = `paymentWebhookEvents/${Buffer.from('verified-event').toString('base64url')}`;
const now = '2026-11-06T12:00:00.000Z';
let writes = 0;
const snapshot = (path: string) => ({ exists: records.has(path), data: () => structuredClone(records.get(path)),
  get: (field: string) => records.get(path)?.[field] });
const collection = (path: string) => ({path, where: () => collection(path), limit: () => collection(path), isQuery: true});
const db = { doc: (path: string) => ({ path }), collection, runTransaction: async (fn: any) => {
  const pending: Array<() => void> = [];
  const tx = {
    get: async (ref: {path: string; isQuery?: boolean}) => { assert.equal(pending.length, 0, 'read after transaction write');
      return ref.isQuery ? {docs: [], empty: true} : snapshot(ref.path); },
    set: (ref: {path: string}, data: any, options?: {merge: boolean}) => pending.push(() => {
      records.set(ref.path, structuredClone(options?.merge ? {...records.get(ref.path), ...data} : data)); writes++;
    }),
    update: (ref: {path: string}, data: any) => pending.push(() => {
      assert.ok(records.has(ref.path)); records.set(ref.path, structuredClone({...records.get(ref.path), ...data})); writes++;
    }),
  };
  const result = await fn(tx);
  pending.forEach(write => write());
  return result;
} };
(globalThis as any).__orderReleaseTestDb = db;
const bundle = await build({ stdin: {contents: `export * from './server/payments/marketplaceOrderPaymentSettlementService.ts';
  export * from './server/payments/orderRefundStateService.ts';
  export * from './server/payments/paymentWebhookProcessor.ts';
  export * from './server/inventory/orderInventoryService.ts';`, resolveDir: process.cwd(), loader: 'ts'},
  bundle: true, platform: 'node', format: 'esm', write: false,
  plugins: [{ name: 'isolated-db', setup(plugin) {
    plugin.onResolve({filter: /firebaseAdmin\.js$/}, () => ({path: 'db', namespace: 'isolated-db'}));
    plugin.onLoad({filter: /^db$/, namespace: 'isolated-db'}, () => ({contents: 'export const adminDb = globalThis.__orderReleaseTestDb;', loader: 'js'}));
    plugin.onResolve({filter: /^firebase-admin\/firestore$/}, () => ({path: 'firestore', namespace: 'isolated-db'}));
    plugin.onLoad({filter: /^firestore$/, namespace: 'isolated-db'}, () => ({contents: 'export const FieldValue = {serverTimestamp:()=>"SERVER_TIMESTAMP", increment:n=>n}; export const Timestamp = {now:()=>({toDate:()=>new Date()})}; export const FieldPath = {documentId:()=>"__name__"};', loader: 'js'}));
    plugin.onResolve({filter: /deliveryStoreReadyOperationalEventService\.js$/}, () => ({path: 'ready', namespace: 'isolated-ready'}));
    plugin.onLoad({filter: /.*/, namespace: 'isolated-ready'}, () => ({contents: 'export const writeStoreMarkedReadyEvidenceInTransaction = async()=>{};', loader: 'js'}));
  }}] });
const { settleMarketplaceOperationalOrderAfterPayment: settle, writeOperationalOrderRefundState: refund,
  processVerifiedPaymentWebhook: webhook,
  transitionOrderStatusWithInventory: transition, reconcilePersistedOrderInventory: reconcile,
  } = await import(`data:text/javascript;base64,${Buffer.from(bundle.outputFiles[0].text + '\n//# sourceURL=isolated-order-release.js').toString('base64')}`);
const execute = () => settle({storeId: 'seller', orderId: 'order', paymentIntentId: 'intent', occurredAt: now});
beforeEach(() => {
  records.clear(); writes = 0;
  for (const [path, data] of orderReleaseFixture(now)) records.set(path, data);
});

test('full verified payment plus approval releases both mirrors and replay preserves authorization', async () => {
  await execute();
  const first = structuredClone(records.get(orderPath));
  assert.equal(isPrepaidOrderReleased(first), true);
  assert.deepEqual(records.get('stores/canonical/orders/order').operationalRelease, first.operationalRelease);
  await execute();
  assert.deepEqual(records.get(orderPath), first);
});
test('a paid pending request remains outside KDS until merchant approval', async () => {
  records.get(orderPath).status = 'pending';
  await execute();
  assert.equal(records.get(orderPath).paymentStatus, 'paid');
  assert.equal(records.get(orderPath).operationalRelease, null);
  assert.equal(isPrepaidOrderReleased(records.get(orderPath)), false);
  records.get(orderPath).status = 'accepted';
  await execute();
  assert.equal(isPrepaidOrderReleased(records.get(orderPath)), true);
});
test('approval without payment waits, then verified settlement permits preparation', async () => {
  records.delete('tenants/seller'); // Exercise the supported legacy inventory authority.
  records.get(orderPath).status = 'pending';
  records.get(paymentPath).status = 'pending';
  const approved = await transition('seller', 'order', 'accepted');
  assert.equal(approved.inventoryAction, 'waiting');
  assert.equal(records.get(orderPath).operationalRelease, null);
  await assert.rejects(transition('seller', 'order', 'preparing'), /liberação financeira/);
  assert.equal((await reconcile('seller', 'order')).inventoryAction, 'waiting');
  records.get(paymentPath).status = 'paid';
  await execute();
  await transition('seller', 'order', 'preparing');
  assert.equal(records.get(orderPath).status, 'preparing');
  assert.equal(isPrepaidOrderReleased(records.get(orderPath)), true);
});
test('a forged release does not bypass live server payment validation', async () => {
  records.delete('tenants/seller');
  await execute();
  records.get(paymentPath).status = 'refunded';
  await assert.rejects(transition('seller', 'order', 'preparing'), /liberação financeira/);
});
test('refund of an old payment preserves current release; current refund revokes both mirrors', async () => {
  await execute();
  const before = structuredClone(records.get(orderPath));
  const input = {storeId:'seller', orderId:'order', provider:'mercado-pago', amount:20, status:'refunded'};
  await refund({...input, paymentId:'old-payment'});
  assert.deepEqual(records.get(orderPath), before);
  await refund({...input, paymentId:'payment'});
  assert.equal(records.get(orderPath).operationalRelease, null);
  assert.equal(records.get('stores/canonical/orders/order').operationalRelease, null);
  assert.equal(isPrepaidOrderReleased(records.get(orderPath)), false);
});
const event = (eventType = 'payment.paid') => ({provider: 'mercado-pago', providerPaymentId: 'psp',
  eventId: eventType, paymentIntentId: 'intent', eventType, amount: 20, currency: 'BRL', method: 'pix',
  occurredAt: now, recipientAccountId: 'collector', signatureVerified: true});
test('verified webhook replay is idempotent and cannot revive a refunded release', async () => {
  records.get(paymentPath).status = 'pending';
  records.get(intentPath).status = 'pending';
  const first = await webhook({storeId:'seller',paymentId:'payment',event:event()});
  assert.equal(first.duplicate, false);
  await execute();
  assert.equal(isPrepaidOrderReleased(records.get(orderPath)), true);
  const before = structuredClone([...records]);
  const second = await webhook({storeId:'seller',paymentId:'payment',event:event()});
  assert.equal(second.duplicate, true);
  assert.deepEqual([...records], before);
  records.get(paymentPath).status = 'charged_back';
  await webhook({storeId:'seller',paymentId:'payment',event:event()});
  assert.equal(records.get(orderPath).operationalRelease, null);
  await assert.rejects(execute);
});
test('a terminal webhook for an old attempt cannot revoke the current payment', async () => {
  await execute();
  records.get(orderPath).paymentId = 'new-payment';
  records.get(orderPath).paymentIntentId = 'new-intent';
  records.get(orderPath).operationalRelease.paymentId = 'new-payment';
  records.get(orderPath).operationalRelease.paymentIntentId = 'new-intent';
  const marker = structuredClone(records.get(orderPath).operationalRelease);
  records.get(paymentPath).status = 'pending';
  records.get(intentPath).status = 'pending';
  await webhook({storeId:'seller',paymentId:'payment',event:event('payment.failed')});
  assert.deepEqual(records.get(orderPath).operationalRelease, marker);
});
for (const status of ['cancelled', 'rejected']) test(`${status} is never revived by late settlement`, async () => {
  records.get(orderPath).status = status;
  const before = structuredClone(records.get(orderPath));
  await execute();
  assert.deepEqual(records.get(orderPath), before);
  assert.equal(writes, 0);
  assert.equal(isPrepaidOrderReleased(records.get(orderPath)), false);
});
for (const [label, mutate] of [
  ['partial payment', () => {records.get(paymentPath).amount = 10;}],
  ['missing immutable receipt', () => records.delete(receiptPath)],
  ['unconfirmed canonical payment', () => {records.get(paymentPath).status = 'pending';}],
  ['refunded payment', () => {records.get(paymentPath).status = 'refunded';}],
  ['unpaid intent', () => {records.get(intentPath).status = 'pending';}],
  ['different buyer', () => {records.get(paymentPath).buyerId = 'other';}],
  ['different store', () => {records.get(paymentPath).storeId = 'other';}],
  ['different order', () => {records.get(paymentPath).orderId = 'other';}],
  ['different intent', () => {records.get(paymentPath).paymentIntentId = 'other';}],
  ['different PSP payment', () => {records.get(paymentPath).providerPaymentId = 'other';}],
  ['wrong receipt amount', () => {records.get(receiptPath).amountMinor = 1999;}],
  ['missing recipient', () => {records.get(receiptPath).recipientAccountId = '';}],
  ['wrong receipt store', () => {records.get(receiptPath).storeId = 'other';}],
  ['wrong receipt currency', () => {records.get(receiptPath).currency = 'USD';}],
  ['wrong store mirror owner', () => {records.get('stores/canonical').ownerId = 'other';}],
  ['sub-cent amount', () => {records.get(paymentPath).amount = 20.001;}],
] as const) test(`no release or writes for ${label}`, async () => {
  mutate();
  await assert.rejects(execute);
  assert.equal(writes, 0);
  assert.equal(isPrepaidOrderReleased(records.get(orderPath)), false);
});
