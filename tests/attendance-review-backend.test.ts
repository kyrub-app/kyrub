import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const workflow = readFileSync('src/utils/orderWorkflow.ts', 'utf8');
const router = readFileSync('server/inventory/orderInventoryRouter.ts', 'utf8');
const service = readFileSync('server/inventory/attendanceReviewService.ts', 'utf8');

test('attendance review client delegates to authenticated backend', () => {
  const start = workflow.indexOf('export const reviewAttendanceOrder');
  assert.ok(start >= 0);
  const reviewSource = workflow.slice(start);
  assert.match(reviewSource, /getIdToken\(\)/);
  assert.match(reviewSource, /\/attendance-review/);
  assert.match(reviewSource, /authorization: `Bearer/);
  assert.doesNotMatch(reviewSource, /runTransaction/);
  assert.doesNotMatch(reviewSource, /transaction\.update/);
});

test('attendance review route authenticates tenant before server transaction', () => {
  assert.match(router, /router\.post\('\/:orderId\/attendance-review'/);
  assert.match(router, /authenticatedTenantId\(request\)/);
  assert.match(router, /reviewAttendanceOrderAuthoritatively/);
  assert.match(service, /adminDb\.runTransaction/);
  assert.match(service, /artifacts\/\$\{tenantId\}\/public\/data\/customerOrders/);
});

test('server only reviews untouched pending dine-in customer orders', () => {
  assert.match(service, /clean\(record\.source\) !== 'customer'/);
  assert.match(service, /clean\(record\.fulfillmentType\) !== 'dine_in'/);
  assert.match(service, /clean\(record\.status\) !== 'pending'/);
  assert.match(service, /clean\(record\.operatorId\)/);
  assert.match(service, /não está mais aguardando revisão/);
});

test('approval validates revised line ids and keeps at least one item', () => {
  assert.match(service, /seen\.has\(lineId\)/);
  assert.match(service, /order\.items\.some\(item => item\.lineId === lineId\)/);
  assert.match(service, /Mantenha ao menos um item ou recuse o pedido/);
  assert.match(service, /subtotal: total/);
  assert.match(service, /total,/);
});

test('rejection requires reason and canonical mirror is updated when available', () => {
  assert.match(service, /action === 'reject' && !reason/);
  assert.match(service, /status: 'rejected'/);
  assert.match(service, /canonicalStoreId/);
  assert.match(service, /stores\/\$\{canonicalStoreId\}\/orders/);
  assert.match(service, /transaction\.set\(canonicalReference/);
});
