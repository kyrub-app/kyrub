import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import type { PublicProduct } from '../src/utils/publicProducts';
import {
  deleteCatalogCategoryTreePath,
  deriveCatalogCategoryPaths,
  MAX_CATALOG_CATEGORY_LEVELS,
  parseCatalogCategoryPaths,
  renameCatalogCategoryTree,
} from '../src/utils/catalogCategoryTree';

const product = (
  id: string,
  category: string,
  categoryCollections: PublicProduct['categoryCollections'] = []
): PublicProduct => ({
  id,
  storeId: 'store-a',
  supplierId: 'store-a',
  name: id,
  description: '',
  price: 10,
  image: '',
  stock: 5,
  category,
  categoryCollections,
  isService: false,
  isComplimentary: false,
  updatedAt: '2026-01-01T00:00:00.000Z',
});

describe('catalog category tree', () => {
  test('derives reusable parent folders from product paths', () => {
    const paths = deriveCatalogCategoryPaths([
      product(
        'repeat',
        'Alimentação > Restaurante > Rodízio > Repetição do rodízio',
        [
          {
            path: 'Alimentação > Restaurante',
            name: 'Restaurante',
            image: 'restaurant.jpg',
          },
          {
            path: 'Alimentação > Restaurante > Rodízio',
            name: 'Rodízio',
            image: 'rodizio.jpg',
          },
        ]
      ),
    ]);

    assert.deepEqual(
      paths.map(path => path.path),
      [
        'Alimentação > Restaurante',
        'Alimentação > Restaurante > Rodízio',
        'Alimentação > Restaurante > Rodízio > Repetição do rodízio',
      ]
    );
    assert.equal(paths[0]?.image, 'restaurant.jpg');
    assert.equal(paths[1]?.image, 'rodizio.jpg');
  });

  test('renaming a folder updates every product and descendant', () => {
    const products = [
      product('menu', 'Alimentação > Restaurante > Menu executivo'),
      product(
        'repeat',
        'Alimentação > Restaurante > Rodízio > Repetição do rodízio'
      ),
      product('pizza', 'Alimentação > Pizzaria > Napolitana'),
    ];

    const result = renameCatalogCategoryTree(
      products,
      deriveCatalogCategoryPaths(products),
      'Alimentação > Restaurante',
      'Restaurantes',
      '2026-07-26T12:00:00.000Z'
    );

    assert.equal(
      result.products[0]?.category,
      'Alimentação > Restaurantes > Menu executivo'
    );
    assert.equal(
      result.products[1]?.category,
      'Alimentação > Restaurantes > Rodízio > Repetição do rodízio'
    );
    assert.equal(
      result.products[2]?.category,
      'Alimentação > Pizzaria > Napolitana'
    );
    assert.equal(result.nextTargetPath, 'Alimentação > Restaurantes');
    assert.ok(
      result.paths.some(
        path =>
          path.path ===
          'Alimentação > Restaurantes > Rodízio > Repetição do rodízio'
      )
    );
  });

  test('deleting a folder promotes products and descendants to its parent', () => {
    const products = [
      product(
        'repeat',
        'Alimentação > Restaurante > Rodízio > Repetição do rodízio'
      ),
      product('buffet', 'Alimentação > Restaurante > Rodízio'),
    ];

    const result = deleteCatalogCategoryTreePath(
      products,
      deriveCatalogCategoryPaths(products),
      'Alimentação > Restaurante > Rodízio',
      '2026-07-26T12:00:00.000Z'
    );

    assert.equal(
      result.products[0]?.category,
      'Alimentação > Restaurante > Repetição do rodízio'
    );
    assert.equal(result.products[1]?.category, 'Alimentação > Restaurante');
    assert.equal(result.parentPath, 'Alimentação > Restaurante');
    assert.ok(
      result.paths.some(
        path =>
          path.path === 'Alimentação > Restaurante > Repetição do rodízio'
      )
    );
    assert.ok(
      !result.paths.some(path => path.path.includes('> Rodízio'))
    );
  });

  test('prevents a rename that would duplicate a sibling folder', () => {
    const products = [
      product('restaurant', 'Alimentação > Restaurante'),
      product('pizza', 'Alimentação > Pizzaria'),
    ];

    assert.throws(
      () =>
        renameCatalogCategoryTree(
          products,
          deriveCatalogCategoryPaths(products),
          'Alimentação > Restaurante',
          'Pizzaria'
        ),
      /Já existe uma pasta/
    );
  });

  test('keeps the persisted hierarchy within six total levels', () => {
    const parsed = parseCatalogCategoryPaths([
      {
        path: 'A > B > C > D > E > F > G',
        name: 'G',
        image: '',
      },
    ]);

    assert.equal(MAX_CATALOG_CATEGORY_LEVELS, 6);
    assert.equal(parsed[0]?.path, 'A > B > C > D > E > F');
    assert.equal(parsed[0]?.name, 'F');
  });
});
