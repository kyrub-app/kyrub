import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { describe, test } from 'node:test';
import type { CustomerOrderItem } from '../src/utils/customerOrders';
import {
  buildProductionTickets,
  DEFAULT_PRODUCTION_STATION,
  getProductionStationOptions,
  normalizeProductionStation,
  parseProductPreparationStations,
  resolveProductPreparationStation,
} from '../src/utils/productionRouting';

const item = (
  productId: string,
  name: string,
  quantity = 1
): CustomerOrderItem => ({
  lineId: `line-${productId}`,
  productId,
  name,
  price: 10,
  quantity,
  paidQuantity: 0,
  transferredQuantity: 0,
  note: '',
  image: '',
  isService: false,
});

const workspaceSource = readFileSync(
  'src/components/store/ProductStationRoutingWorkspace.tsx',
  'utf8'
);
const inboxSource = readFileSync(
  'src/components/customer/CustomerOrderInbox.tsx',
  'utf8'
);
const appSource = readFileSync('src/App.tsx', 'utf8');

describe('production station routing', () => {
  test('normalizes route names and defaults unassigned items to GERAL', () => {
    assert.equal(normalizeProductionStation('  cozinha  '), 'COZINHA');
    assert.equal(normalizeProductionStation(''), DEFAULT_PRODUCTION_STATION);
    assert.equal(resolveProductPreparationStation('unknown', {}), 'GERAL');
  });

  test('parses only valid product identifiers and station names', () => {
    assert.deepEqual(
      parseProductPreparationStations({
        'product-1': 'bar',
        'product-2': ' cozinha ',
        'invalid/id': 'expedição',
        'product-3': '',
      }),
      {
        'product-1': 'BAR',
        'product-2': 'COZINHA',
      }
    );
  });

  test('groups one order into production tickets by station', () => {
    const items = [
      item('drink', 'Suco', 2),
      item('meal', 'Prato', 1),
      item('dessert', 'Bolo', 3),
    ];
    const routes = {
      drink: 'BAR',
      meal: 'COZINHA',
      dessert: 'CONFEITARIA',
    };
    const tickets = buildProductionTickets(items, routes);
    assert.deepEqual(
      tickets.map(ticket => [ticket.station, ticket.quantity]),
      [
        ['BAR', 2],
        ['COZINHA', 1],
        ['CONFEITARIA', 3],
      ]
    );
    assert.deepEqual(getProductionStationOptions(items, routes), [
      'BAR',
      'COZINHA',
      'CONFEITARIA',
    ]);
  });

  test('routing workspace persists product tags inside tenant operational settings', () => {
    const utilitySource = readFileSync('src/utils/productionRouting.ts', 'utf8');
    assert.match(utilitySource, /operationalSettings/);
    assert.match(utilitySource, /productPreparationStations/);
    assert.match(utilitySource, /runTransaction/);
    assert.match(workspaceSource, /Estação de preparo por item/);
    assert.match(workspaceSource, /kyrub_producao_spaces/);
    assert.match(appSource, /ProductStationRoutingWorkspace/);
  });

  test('KDS places station filter below origin and filters items by product route', () => {
    const originPosition = inboxSource.indexOf('Origem do pedido');
    const stationPosition = inboxSource.indexOf('Estação de preparo');
    const stagePosition = inboxSource.indexOf("{ id: 'active', label: 'Ativos' }");
    assert.ok(originPosition >= 0);
    assert.ok(stationPosition > originPosition);
    assert.ok(stagePosition >= 0);
    assert.match(inboxSource, /stationFilter/);
    assert.match(inboxSource, /resolveProductPreparationStation/);
    assert.match(inboxSource, /Todas as estações/);
    assert.match(inboxSource, /Altere a origem, a estação ou a etapa/);
  });
});
