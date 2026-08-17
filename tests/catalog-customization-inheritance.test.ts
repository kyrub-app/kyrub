import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import type { Product } from '../src/types';
import {
  parseCatalogCustomizationDefaults,
  resolveCatalogCustomization,
  upsertCatalogCustomizationDefaults,
} from '../src/utils/catalogCustomizationInheritance';

const product = (patch: Partial<Product> = {}): Product => ({
  id: 'x-burger',
  name: 'X-Burger',
  description: '',
  price: 29.5,
  image: '',
  stock: 0,
  category: 'Alimentação > Lanches > Burgers Artesanais',
  ...patch,
});

describe('catalog customization inheritance', () => {
  test('inherits quick notes from group and subgroup and keeps product notes', () => {
    const defaults = parseCatalogCustomizationDefaults([
      {
        path: 'Alimentação > Lanches',
        quickNotes: ['Sem cebola', 'Molho à parte'],
      },
      {
        path: 'Alimentação > Lanches > Burgers Artesanais',
        quickNotes: ['Bem passado', 'Sem cebola'],
      },
    ]);

    const result = resolveCatalogCustomization(
      product({ quickNotes: ['Cortar ao meio'] }),
      defaults
    );

    assert.deepEqual(result.quickNotes, [
      'Sem cebola',
      'Molho à parte',
      'Bem passado',
      'Cortar ao meio',
    ]);
  });

  test('more specific option group overrides inherited group with the same name', () => {
    const defaults = parseCatalogCustomizationDefaults([
      {
        path: 'Alimentação > Lanches',
        optionGroups: [{
          id: 'meat-point',
          name: 'Ponto da carne',
          minSelections: 1,
          maxSelections: 1,
          choices: [{ id: 'well', name: 'Bem passada', priceDelta: 0 }],
        }],
      },
      {
        path: 'Alimentação > Lanches > Burgers Artesanais',
        optionGroups: [{
          id: 'meat-point-burger',
          name: 'Ponto da carne',
          minSelections: 1,
          maxSelections: 1,
          choices: [{ id: 'medium', name: 'Ao ponto', priceDelta: 0 }],
        }],
      },
    ]);

    const result = resolveCatalogCustomization(product(), defaults);
    assert.equal(result.optionGroups.length, 1);
    assert.equal(result.optionGroups[0]?.choices[0]?.name, 'Ao ponto');
  });

  test('product option group has final precedence over group and subgroup', () => {
    const defaults = parseCatalogCustomizationDefaults([
      {
        path: 'Alimentação > Lanches',
        optionGroups: [{
          id: 'extras',
          name: 'Extras',
          minSelections: 0,
          maxSelections: 1,
          choices: [{ id: 'bacon', name: 'Bacon', priceDelta: 4 }],
        }],
      },
    ]);

    const result = resolveCatalogCustomization(
      product({
        optionGroups: [{
          id: 'extras-product',
          name: 'Extras',
          minSelections: 0,
          maxSelections: 1,
          choices: [{ id: 'egg', name: 'Ovo', priceDelta: 3 }],
        }],
      }),
      defaults
    );

    assert.equal(result.optionGroups[0]?.choices[0]?.name, 'Ovo');
  });

  test('does not inherit defaults from a sibling hierarchy', () => {
    const defaults = parseCatalogCustomizationDefaults([
      {
        path: 'Alimentação > Sobremesas',
        quickNotes: ['Sem cobertura'],
      },
    ]);

    assert.deepEqual(resolveCatalogCustomization(product(), defaults).quickNotes, []);
  });

  test('stores defaults only at group or subgroup depth', () => {
    const group = upsertCatalogCustomizationDefaults(
      [],
      'Alimentação > Lanches',
      { quickNotes: ['Sem cebola'] }
    );
    const subgroup = upsertCatalogCustomizationDefaults(
      group,
      'Alimentação > Lanches > Burgers Artesanais',
      { quickNotes: ['Bem passado'] }
    );

    assert.equal(subgroup.length, 2);
    assert.throws(
      () => upsertCatalogCustomizationDefaults([], 'Alimentação', { quickNotes: [] }),
      /Grupo ou Subgrupo/
    );
  });
});
