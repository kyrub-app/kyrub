import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import type { Product } from '../src/types';
import {
  buildProductConfigurationSelection,
  parseProductOptionGroups,
} from '../src/utils/productCustomization';

const menuProduct: Product = {
  id: 'menu-executivo',
  name: 'Menu Executivo',
  description: '',
  price: 45,
  image: '',
  stock: 20,
  supplierId: 'store-a',
  category: 'Almoço',
  optionGroups: [
    {
      id: 'entrada',
      name: 'Entrada',
      minSelections: 1,
      maxSelections: 1,
      choices: [
        { id: 'salada', name: 'Salada', priceDelta: 0 },
        { id: 'sopa', name: 'Sopa', priceDelta: 3 },
      ],
    },
    {
      id: 'principal',
      name: 'Principal',
      minSelections: 1,
      maxSelections: 1,
      choices: [
        { id: 'frango', name: 'Frango', priceDelta: 0 },
        { id: 'peixe', name: 'Peixe', priceDelta: 8 },
      ],
    },
    {
      id: 'acompanhamentos',
      name: 'Acompanhamentos',
      minSelections: 1,
      maxSelections: 2,
      choices: [
        { id: 'arroz', name: 'Arroz', priceDelta: 0 },
        { id: 'feijao', name: 'Feijão', priceDelta: 0 },
        { id: 'fritas', name: 'Fritas', priceDelta: 5 },
      ],
    },
  ],
};

describe('product customization', () => {
  test('supports sequential menu stages and multiple selections', () => {
    const selection = buildProductConfigurationSelection(menuProduct, {
      entrada: ['sopa'],
      principal: ['peixe'],
      acompanhamentos: ['arroz', 'fritas'],
    });

    assert.equal(selection.unitPrice, 61);
    assert.equal(selection.id, selection.lineKey);
    assert.equal(selection.sourceProductId, 'menu-executivo');
    assert.match(selection.customizationSummary, /Entrada: Sopa/);
    assert.match(selection.customizationSummary, /Principal: Peixe/);
    assert.match(selection.customizationSummary, /Acompanhamentos: Arroz, Fritas/);
    assert.match(selection.name, /Menu Executivo — Entrada: Sopa/);
    assert.equal(selection.selectedOptions.length, 4);
  });

  test('rejects incomplete required stages', () => {
    assert.throws(
      () =>
        buildProductConfigurationSelection(menuProduct, {
          entrada: ['salada'],
          principal: [],
          acompanhamentos: ['arroz'],
        }),
      /Principal/
    );
  });

  test('rejects selections above the configured maximum', () => {
    assert.throws(
      () =>
        buildProductConfigurationSelection(menuProduct, {
          entrada: ['salada'],
          principal: ['frango'],
          acompanhamentos: ['arroz', 'feijao', 'fritas'],
        }),
      /Acompanhamentos/
    );
  });

  test('complimentary repetitions keep zero base price and only charge explicit extras', () => {
    const repetition: Product = {
      ...menuProduct,
      id: 'rodizio-repeat',
      name: 'Repetição do rodízio',
      price: 99,
      isComplimentary: true,
      optionGroups: [
        {
          id: 'ponto',
          name: 'Ponto da carne',
          minSelections: 1,
          maxSelections: 1,
          choices: [
            { id: 'mal', name: 'Malpassada', priceDelta: 0 },
            { id: 'extra', name: 'Corte premium', priceDelta: 12 },
          ],
        },
      ],
    };

    const included = buildProductConfigurationSelection(repetition, {
      ponto: ['mal'],
    });
    const premium = buildProductConfigurationSelection(repetition, {
      ponto: ['extra'],
    });

    assert.equal(included.unitPrice, 0);
    assert.equal(premium.unitPrice, 12);
  });

  test('sanitizes optional, single and multiple-choice groups', () => {
    assert.deepEqual(
      parseProductOptionGroups([
        {
          id: 'extras',
          name: 'Extras',
          minSelections: 0,
          maxSelections: 2,
          choices: [
            { id: 'a', name: 'A', priceDelta: 0 },
            { id: 'b', name: 'B', priceDelta: 2.5 },
          ],
        },
      ]),
      [
        {
          id: 'extras',
          name: 'Extras',
          minSelections: 0,
          maxSelections: 2,
          choices: [
            { id: 'a', name: 'A', priceDelta: 0 },
            { id: 'b', name: 'B', priceDelta: 2.5 },
          ],
        },
      ]
    );
  });
});
