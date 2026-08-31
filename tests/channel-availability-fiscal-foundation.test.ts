import assert from 'node:assert/strict';
import test from 'node:test';
import {
  buildInventoryReservationLines,
  calculateAvailableToPromise,
  evaluateFiscalEventCandidate,
  projectChannelAvailability,
  type InventoryReservation,
} from '../shared/channelAvailabilityFiscalFoundation';

const inventory = [
  { id: 'bread', currentQuantity: 10 },
  { id: 'meat', currentQuantity: 1_400 },
];
const composition = {
  yieldQuantity: 1,
  lines: [
    { inventoryItemId: 'bread', quantity: 1 },
    { inventoryItemId: 'meat', quantity: 140 },
  ],
};

test('reservation lines reserve inventory components instead of channel stock counters', () => {
  assert.deepEqual(
    buildInventoryReservationLines({ productQuantity: 2, composition }),
    [
      { inventoryItemId: 'bread', quantity: 2 },
      { inventoryItemId: 'meat', quantity: 280 },
    ]
  );
});

test('active reservations reduce global available-to-promise across every channel', () => {
  const reservations: InventoryReservation[] = [{
    id: 'reservation-1',
    storeId: 'store-1',
    orderId: 'order-99food-1',
    sourceChannel: '99food',
    status: 'active',
    lines: buildInventoryReservationLines({ productQuantity: 3, composition }),
  }];

  const result = calculateAvailableToPromise({ inventory, composition, reservations });
  assert.equal(result.physicalCompositionUnits, 10);
  assert.equal(result.availableToPromiseUnits, 7);
  assert.equal(result.reservedComponentQuantities.bread, 3);
  assert.equal(result.reservedComponentQuantities.meat, 420);
});

test('released consumed and expired reservations do not reserve current ATP', () => {
  const lines = buildInventoryReservationLines({ productQuantity: 3, composition });
  const reservations: InventoryReservation[] = (['released', 'consumed', 'expired'] as const).map((status, index) => ({
    id: `reservation-${index}`,
    storeId: 'store-1',
    orderId: `order-${index}`,
    sourceChannel: 'mercado_livre',
    status,
    lines,
  }));

  assert.equal(
    calculateAvailableToPromise({ inventory, composition, reservations }).availableToPromiseUnits,
    10
  );
});

test('channel policy projects safety stock and allocation cap without changing inventory authority', () => {
  const projection = projectChannelAvailability({
    inventory,
    composition,
    reservations: [],
    policy: {
      channel: 'mercado_livre',
      enabled: true,
      safetyStockUnits: 2,
      allocationCapUnits: 5,
    },
  });
  assert.equal(projection.availableToPromiseUnits, 10);
  assert.equal(projection.publishableUnits, 5);
  assert.equal(projection.authority, 'kyrub_inventory_and_reservation_projection');
});

test('disabled channel publishes zero while preserving ATP evidence', () => {
  const projection = projectChannelAvailability({
    inventory,
    composition,
    reservations: [],
    policy: {
      channel: '99food',
      enabled: false,
      safetyStockUnits: 0,
      allocationCapUnits: null,
    },
  });
  assert.equal(projection.availableToPromiseUnits, 10);
  assert.equal(projection.publishableUnits, 0);
});

test('fiscal candidate is source-neutral and waits for commercial confirmation', () => {
  const candidate = evaluateFiscalEventCandidate({
    storeId: 'store-1',
    orderId: 'order-1',
    sourceChannel: '99food',
    commerciallyConfirmed: false,
    items: [{ productId: 'burger', kind: 'goods', fiscalProfileReady: true }],
  });
  assert.equal(candidate.status, 'not_triggered');
  assert.equal(candidate.documentFamily, null);
});

test('missing product fiscal preparation blocks fiscal policy instead of inventing taxes', () => {
  const candidate = evaluateFiscalEventCandidate({
    storeId: 'store-1',
    orderId: 'order-ml-1',
    sourceChannel: 'mercado_livre',
    commerciallyConfirmed: true,
    items: [
      { productId: 'burger', kind: 'goods', fiscalProfileReady: true },
      { productId: 'drink', kind: 'goods', fiscalProfileReady: false },
    ],
  });
  assert.equal(candidate.status, 'blocked_missing_fiscal_data');
  assert.deepEqual(candidate.missingProductIds, ['drink']);
  assert.equal(candidate.documentFamily, null);
});

test('goods services and mixed orders remain separated before fiscal emission policy', () => {
  const goods = evaluateFiscalEventCandidate({
    storeId: 'store-1', orderId: 'g', sourceChannel: 'kyrub', commerciallyConfirmed: true,
    items: [{ productId: 'p', kind: 'goods', fiscalProfileReady: true }],
  });
  const service = evaluateFiscalEventCandidate({
    storeId: 'store-1', orderId: 's', sourceChannel: 'kyrub', commerciallyConfirmed: true,
    items: [{ productId: 's', kind: 'service', fiscalProfileReady: true }],
  });
  const mixed = evaluateFiscalEventCandidate({
    storeId: 'store-1', orderId: 'm', sourceChannel: '99food', commerciallyConfirmed: true,
    items: [
      { productId: 'p', kind: 'goods', fiscalProfileReady: true },
      { productId: 's', kind: 'service', fiscalProfileReady: true },
    ],
  });

  assert.equal(goods.documentFamily, 'goods_document_policy_required');
  assert.equal(service.documentFamily, 'nfse');
  assert.equal(mixed.documentFamily, 'mixed_operation_review_required');
  assert.equal(goods.status, 'ready_for_fiscal_policy');
});
