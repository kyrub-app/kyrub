import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import type { Product } from '../src/types';
import {
  resolveCatalogCustomization,
  type CatalogCustomizationDefaults,
} from '../src/utils/catalogCustomizationInheritance';

const product = (category: string): Product => ({
  id: 'burger-1',
  name: 'X-Burger',
  description: '',
  price: 29.5,
  image: '',
  stock: 10,
  category,
});

test('storefront resolves group and subgroup defaults before customer customization', () => {
  const defaults: CatalogCustomizationDefaults[] = [
    {
      path: 'Alimentação > Lanches',
      quickNotes: ['Sem cebola'],
      optionGroups: [
        {
          id: 'point',
          name: 'Ponto da carne',
          minSelections: 1,
          maxSelections: 1,
          choices: [
            { id: 'medium', name: 'Ao ponto', priceDelta: 0 },
            { id: 'well', name: 'Bem passado', priceDelta: 0 },
          ],
        },
      ],
    },
    {
      path: 'Alimentação > Lanches > Burgers Artesanais',
      quickNotes: ['Molho à parte'],
      optionGroups: [
        {
          id: 'extras',
          name: 'Adicionais',
          minSelections: 0,
          maxSelections: 1,
          choices: [{ id: 'bacon', name: 'Bacon extra', priceDelta: 5 }],
        },
      ],
    },
  ];

  const resolved = resolveCatalogCustomization(
    product('Alimentação > Lanches > Burgers Artesanais'),
    defaults
  );

  assert.deepEqual(resolved.quickNotes, ['Sem cebola', 'Molho à parte']);
  assert.deepEqual(
    resolved.optionGroups.map(group => group.name),
    ['Ponto da carne', 'Adicionais']
  );
});

test('public storefront wrapper hydrates products with inherited customization', () => {
  const storefront = readFileSync('src/components/StorefrontPanel.tsx', 'utf8');
  assert.match(storefront, /catalogCustomizationDefaults/);
  assert.match(storefront, /resolveCatalogCustomization/);
  assert.match(storefront, /products=\{storefrontProducts\}/);
});

test('owner product editor exposes group and subgroup defaults', () => {
  const bridge = readFileSync(
    'src/components/store/CatalogCustomizationInheritanceBridge.tsx',
    'utf8'
  );
  assert.match(bridge, /Padrões herdados do catálogo/);
  assert.match(bridge, /saveCatalogCustomizationDefaults/);
  assert.match(bridge, /ProductQuickNotesEditor/);
  assert.match(bridge, /ProductOptionGroupsEditor/);
});

test('configured order line is reconciled against the source product recipe', () => {
  const adjustment = readFileSync(
    'server/inventory/orderInventoryAdjustment.ts',
    'utf8'
  );
  assert.match(adjustment, /sourceProductId/);
  assert.match(adjustment, /split\('::', 1\)/);
  assert.match(
    adjustment,
    /sourceProductId\(item\.productId, item\.sourceProductId\)/
  );
});
