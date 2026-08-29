import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import {
  buildLocalServiceSummary,
  isActiveLocalServiceOrder,
  isLocalServiceOrder,
} from '../shared/localService';

const order = (overrides: Record<string, string> = {}) => ({
  id: overrides.id ?? 'order-1',
  fulfillmentType: overrides.fulfillmentType ?? 'dine_in',
  status: overrides.status ?? 'accepted',
  tableCode: overrides.tableCode ?? '12',
  source: overrides.source ?? 'customer',
  operatorId: overrides.operatorId ?? 'operator-1',
});

test('local service includes dine-in and pickup but explicitly excludes delivery', () => {
  assert.equal(isLocalServiceOrder(order({ fulfillmentType: 'dine_in' })), true);
  assert.equal(isLocalServiceOrder(order({ fulfillmentType: 'pickup' })), true);
  assert.equal(isLocalServiceOrder(order({ fulfillmentType: 'delivery' })), false);
  assert.equal(
    isActiveLocalServiceOrder(order({ fulfillmentType: 'delivery', status: 'preparing' })),
    false
  );
});

test('local service summary derives operational counts without parallel state', () => {
  const summary = buildLocalServiceSummary([
    order({ id: 'table-1', tableCode: '12', status: 'accepted' }),
    order({ id: 'table-2', tableCode: '12', status: 'ready' }),
    order({
      id: 'approval-1',
      tableCode: '7',
      status: 'pending',
      source: 'customer',
      operatorId: '',
    }),
    order({ id: 'pickup-1', fulfillmentType: 'pickup', tableCode: '', status: 'ready' }),
    order({ id: 'delivery-1', fulfillmentType: 'delivery', tableCode: '', status: 'ready' }),
    order({ id: 'closed-1', tableCode: '9', status: 'completed' }),
  ]);

  assert.deepEqual(summary, {
    activeOrders: 4,
    activeTables: 2,
    pendingApprovals: 1,
    inProduction: 1,
    readyForTable: 1,
    waitingPickup: 1,
  });
});

test('PDV overview reuses canonical customer orders and existing pickup navigation', () => {
  const bridge = readFileSync('src/components/store/LocalServicePdvBridge.tsx', 'utf8');
  assert.match(bridge, /subscribeToStoreCustomerOrders\(/);
  assert.match(bridge, /buildLocalServiceSummary\(orders\)/);
  assert.match(bridge, /getElementById\('erp-clientes-tab'\)/);
  assert.match(bridge, /getElementById\('kyrub-pdv-pickup-tab'\)/);
  assert.match(bridge, /PDV · Atendimento Local/);
  assert.match(bridge, /Entregas não participam deste painel/);
});

test('secure pickup remains the only completion path for ready pickup in the local PDV', () => {
  const pickup = readFileSync('src/components/store/PickupPdvNavigationBridge.tsx', 'utf8');
  const execution = readFileSync('server/inventory/orderStatusExecutionService.ts', 'utf8');
  const eligibility = readFileSync(
    'server/payments/economicObligationEligibilityService.ts',
    'utf8'
  );

  assert.match(pickup, /order\.fulfillmentType === 'pickup' && order\.status === 'ready'/);
  assert.match(pickup, /handoffCode: pickupCode/);
  assert.match(pickup, /'completed'/);
  assert.match(execution, /data\.fulfillmentType !== 'pickup' \|\| data\.status !== 'ready'/);
  assert.match(execution, /safeEqualCode\(/);
  assert.match(execution, /finalizePickupHandoffWithEconomicEligibility/);
  assert.match(eligibility, /status: 'handed_over'/);
  assert.match(eligibility, /currentHandoffStatus !== 'verified'/);
});

test('local service bridge is mounted next to existing pickup authority', () => {
  const main = readFileSync('src/main.tsx', 'utf8');
  assert.match(main, /<LocalServicePdvBridge \/>/);
  assert.match(main, /<PickupPdvNavigationBridge \/>/);
});
