import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import {
  buildLocalServiceSummary,
  isActiveLocalServiceOrder,
  isLocalServiceOrder,
} from '../shared/localService';
import {
  buildServiceLocation,
  buildServiceLocationSnapshot,
  resolveOrderServiceLocation,
  serviceLocationPath,
  type ServiceLocationSnapshot,
} from '../shared/serviceLocation';

const order = (
  overrides: Record<string, unknown> = {}
) => ({
  id: String(overrides.id ?? 'order-1'),
  fulfillmentType: String(overrides.fulfillmentType ?? 'dine_in'),
  status: String(overrides.status ?? 'accepted'),
  tableCode: String(overrides.tableCode ?? '12'),
  serviceLocation:
    (overrides.serviceLocation as ServiceLocationSnapshot | null | undefined) ?? undefined,
  source: String(overrides.source ?? 'customer'),
  operatorId: String(overrides.operatorId ?? 'operator-1'),
});

test('service location has stable store scope and immutable order snapshot data', () => {
  const location = buildServiceLocation({
    id: 'table-7',
    storeId: 'store-1',
    kind: 'table',
    label: 'Mesa 7',
    now: '2026-09-16T12:00:00.000Z',
  });
  const snapshot = buildServiceLocationSnapshot(location);

  assert.equal(
    serviceLocationPath('store-1', 'table-7'),
    'stores/store-1/serviceLocations/table-7'
  );
  assert.deepEqual(snapshot, {
    schemaVersion: 1,
    id: 'table-7',
    kind: 'table',
    label: 'Mesa 7',
  });
});

test('canonical service location wins over legacy tableCode and malformed context falls back safely', () => {
  const canonical = resolveOrderServiceLocation({
    serviceLocation: {
      schemaVersion: 1,
      id: 'counter-2',
      kind: 'counter',
      label: 'Balcão 2',
    },
    tableCode: '12',
  });
  assert.equal(canonical?.source, 'canonical');
  assert.equal(canonical?.kind, 'counter');
  assert.equal(canonical?.label, 'Balcão 2');

  const fallback = resolveOrderServiceLocation({
    serviceLocation: {
      schemaVersion: 1,
      id: '',
      kind: 'admin',
      label: 'Área privilegiada',
    },
    tableCode: ' 12 ',
  });
  assert.equal(fallback?.source, 'legacy_table_code');
  assert.equal(fallback?.kind, 'table');
  assert.equal(fallback?.label, '12');
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
      id: 'counter-1',
      tableCode: 'legacy-ignored',
      serviceLocation: {
        schemaVersion: 1,
        id: 'counter-2',
        kind: 'counter',
        label: 'Balcão 2',
      },
      status: 'accepted',
    }),
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
    activeOrders: 5,
    activeServiceLocations: 3,
    activeTables: 2,
    pendingApprovals: 1,
    inProduction: 2,
    readyForServiceLocation: 1,
    readyForTable: 1,
    waitingPickup: 1,
  });
});

test('PDV stays operational while the local service KPI dashboard lives under the Renda store access', () => {
  const bridge = readFileSync('src/components/store/LocalServicePdvBridge.tsx', 'utf8');
  const dashboard = readFileSync(
    'src/components/store/LocalServiceDashboardCards.tsx',
    'utf8'
  );
  const renda = readFileSync('src/components/tabs/RendaTab.tsx', 'utf8');

  assert.match(bridge, /subscribeToStoreCustomerOrders\(/);
  assert.match(bridge, /buildLocalServiceSummary\(orders\)/);
  assert.match(bridge, /getElementById\('erp-clientes-tab'\)/);
  assert.match(bridge, /PDV · Atendimento Local/);
  assert.match(bridge, /Entregas não participam deste painel/);
  assert.doesNotMatch(bridge, /Locais ativos/);
  assert.doesNotMatch(bridge, /Aguardando aprovação/);
  assert.doesNotMatch(bridge, /Em fluxo local/);
  assert.doesNotMatch(bridge, /Aguardando retirada/);

  assert.match(dashboard, /subscribeToStoreCustomerOrders\(/);
  assert.match(dashboard, /buildLocalServiceSummary\(orders\)/);
  assert.match(dashboard, /summary\.activeServiceLocations/);
  assert.match(dashboard, /Locais ativos/);
  assert.match(dashboard, /Aguardando aprovação/);
  assert.match(dashboard, /Em fluxo local/);
  assert.match(dashboard, /Aguardando retirada/);
  assert.match(dashboard, /Pedido pronto para retirada permanece aberto/);

  assert.match(renda, /LocalServiceDashboardCards/);
  assert.match(renda, /id="btn-criar-loja-ofertas"/);
  assert.match(
    renda,
    /btn-criar-loja-ofertas[\s\S]*hasConfiguredStore && <LocalServiceDashboardCards \/>/
  );
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

test('service location foundation carries no customer identity, permission or fiscal authority', () => {
  const source = readFileSync('shared/serviceLocation.ts', 'utf8');
  assert.doesNotMatch(source, /customerId|buyerId|email|phone|permission|role|fiscal|invoice|payment/i);
  assert.doesNotMatch(source, /nfc|qr|token/i);
});

test('local service bridge is mounted next to existing pickup authority', () => {
  const main = readFileSync('src/main.tsx', 'utf8');
  assert.match(main, /<LocalServicePdvBridge \/>/);
  assert.match(main, /<PickupPdvNavigationBridge \/>/);
});
