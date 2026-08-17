import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { describe, test } from 'node:test';
import type {
  InventoryCatalogRecord,
  InventoryCompositionRecord,
} from '../shared/inventoryConsumption';
import {
  buildOrderInventoryConsumptionWithOptions,
  parseConfiguredLineSelectedOptions,
  type OptionInventoryImpactRecord,
} from '../shared/optionInventoryImpact';

const catalog: InventoryCatalogRecord[] = [
  {
    id: 'burger-patty',
    name: 'Hambúrguer',
    unit: 'g',
    currentQuantity: 280,
    minimumQuantity: 0,
    purchaseCost: 0,
    supplier: '',
    updatedAt: '',
  },
  {
    id: 'bacon',
    name: 'Bacon',
    unit: 'g',
    currentQuantity: 60,
    minimumQuantity: 0,
    purchaseCost: 0,
    supplier: '',
    updatedAt: '',
  },
];

const compositions: Record<string, InventoryCompositionRecord> = {
  'burger-1': {
    kind: 'recipe',
    yieldQuantity: 1,
    lines: [{ inventoryItemId: 'burger-patty', quantity: 140 }],
    updatedAt: '',
  },
};

const impacts: OptionInventoryImpactRecord[] = [
  {
    scopeType: 'catalog_path',
    scopeId: 'Alimentação > Lanches > Burgers Artesanais',
    groupId: 'extras',
    choiceId: 'bacon-extra',
    lines: [{ inventoryItemId: 'bacon', quantity: 30 }],
  },
];

describe('option inventory impacts', () => {
  test('reads selected option ids from the configured cart line', () => {
    assert.deepEqual(
      parseConfiguredLineSelectedOptions(
        'burger-1::options=point:medium|extras:bacon-extra&notes=sem-cebola'
      ),
      [
        { groupId: 'point', choiceId: 'medium' },
        { groupId: 'extras', choiceId: 'bacon-extra' },
      ]
    );
  });

  test('consumes recipe and selected modifier ingredients in one decision', () => {
    const lines = buildOrderInventoryConsumptionWithOptions(
      [
        {
          productId: 'burger-1',
          name: 'X-Burger',
          quantity: 2,
          selectedOptions: [{ groupId: 'extras', choiceId: 'bacon-extra' }],
        },
      ],
      catalog,
      compositions,
      { 'burger-1': 'Alimentação > Lanches > Burgers Artesanais' },
      impacts
    );

    assert.deepEqual(
      lines.map(line => ({
        id: line.inventoryItemId,
        quantity: line.quantity,
        after: line.afterQuantity,
      })),
      [
        { id: 'bacon', quantity: 60, after: 0 },
        { id: 'burger-patty', quantity: 280, after: 0 },
      ]
    );
  });

  test('blocks when base recipe plus modifier exceed available stock', () => {
    assert.throws(
      () =>
        buildOrderInventoryConsumptionWithOptions(
          [
            {
              productId: 'burger-1',
              name: 'X-Burger',
              quantity: 2,
              selectedOptions: [
                { groupId: 'extras', choiceId: 'bacon-extra' },
              ],
            },
          ],
          [{ ...catalog[0]!, currentQuantity: 280 }, { ...catalog[1]!, currentQuantity: 50 }],
          compositions,
          { 'burger-1': 'Alimentação > Lanches > Burgers Artesanais' },
          impacts
        ),
      /Estoque insuficiente de “Bacon”/
    );
  });

  test('server reads and writes both current and legacy private inventory field names', () => {
    const service = readFileSync(
      'server/inventory/orderInventoryService.ts',
      'utf8'
    );
    assert.match(service, /inventoryData\?\.catalog \?\? inventoryData\?\.inventoryCatalog/);
    assert.match(service, /inventoryData\?\.compositions \?\? inventoryData\?\.productCompositions/);
    assert.match(service, /inventoryCatalog: consumedCatalog/);
    assert.match(service, /optionInventoryImpacts/);
  });

  test('modifier-to-stock mapping remains in the private inventory document', () => {
    const clientStore = readFileSync(
      'src/utils/productOptionInventory.ts',
      'utf8'
    );
    const publicProducts = readFileSync('src/utils/publicProducts.ts', 'utf8');
    assert.match(clientStore, /getProductInventoryDocumentPath/);
    assert.match(clientStore, /optionInventoryImpacts/);
    assert.doesNotMatch(publicProducts, /optionInventoryImpacts/);
  });
});
