import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import {
  buildPublicProduct,
  parsePublicProducts,
  parseProductCategoryCollections,
} from '../src/utils/publicProducts';

describe('public marketplace products', () => {
  test('builds a product only from user-provided values', () => {
    const product = buildPublicProduct(
      { uid: 'user-a' },
      {
        name: 'Produto real',
        description: '',
        price: '12.50',
        stock: '',
        category: 'Categoria própria',
        image: '',
        isService: false,
      },
      1_700_000_000_000
    );

    assert.equal(product.id, 'product-user-a-1700000000000');
    assert.equal(product.storeId, 'user-a');
    assert.equal(product.supplierId, 'user-a');
    assert.equal(product.description, '');
    assert.equal(product.image, '');
    assert.equal(product.stock, 0);
    assert.equal(product.category, 'Categoria própria');
    assert.equal(product.storePointsPerUnit, 0);
  });

  test('keeps store points on the same canonical product round trip', () => {
    const product = buildPublicProduct(
      { uid: 'user-a' },
      {
        name: 'Produto pontuado',
        description: '',
        price: '20',
        stock: '5',
        category: 'Categoria própria',
        image: '',
        isService: false,
        storePointsPerUnit: 25,
      },
      1_700_000_000_001
    );

    assert.equal(product.storePointsPerUnit, 25);
    const [parsed] = parsePublicProducts([product]);
    assert.equal(parsed?.id, product.id);
    assert.equal(parsed?.storePointsPerUnit, 25);

    assert.throws(
      () =>
        buildPublicProduct(
          { uid: 'user-a' },
          {
            name: 'Pontuação inválida',
            description: '',
            price: '20',
            stock: '5',
            category: 'Categoria própria',
            image: '',
            isService: false,
            storePointsPerUnit: -1,
          }
        ),
      /STORE_POINTS_PER_UNIT_INVALID/
    );
  });

  test('services do not receive fictitious stock', () => {
    const product = buildPublicProduct(
      { uid: 'user-a' },
      {
        name: 'Serviço',
        description: 'Atendimento',
        price: '80',
        stock: '999',
        category: 'Serviços locais',
        image: '',
        isService: true,
      },
      123
    );

    assert.equal(product.stock, 0);
    assert.equal(product.isService, true);
  });

  test('requires real category and valid commercial values', () => {
    assert.throws(
      () =>
        buildPublicProduct(
          { uid: 'user-a' },
          {
            name: 'Item',
            description: '',
            price: '-1',
            stock: '0',
            category: '',
            image: '',
            isService: false,
          }
        ),
      /preço válido|categoria/
    );
  });

  test('persists cumulative collection paths and staff-selected images', () => {
    const product = buildPublicProduct(
      { uid: 'user-a' },
      {
        name: 'Vinho reserva',
        description: '',
        price: '120',
        stock: '4',
        category: 'Vinhos > Branco > Italiano',
        image: '/api/media/drive?fileId=product',
        isService: false,
        categoryCollections: [
          {
            path: 'Vinhos > Branco',
            name: 'Branco',
            image: '/api/media/drive?fileId=white',
          },
          {
            path: 'Vinhos > Branco > Italiano',
            name: 'Italiano',
            image: '/api/media/drive?fileId=italian',
          },
        ],
      },
      456
    );

    assert.deepEqual(product.categoryCollections, [
      {
        path: 'Vinhos > Branco',
        name: 'Branco',
        image: '/api/media/drive?fileId=white',
      },
      {
        path: 'Vinhos > Branco > Italiano',
        name: 'Italiano',
        image: '/api/media/drive?fileId=italian',
      },
    ]);
  });

  test('sanitizes duplicated or malformed collection metadata', () => {
    assert.deepEqual(
      parseProductCategoryCollections([
        { path: 'Vinhos > Branco', name: 'Branco', image: 'photo-a' },
        { path: 'vinhos > branco', name: 'Repetido', image: 'photo-b' },
        { path: '', name: 'Inválido', image: '' },
        null,
      ]),
      [{ path: 'Vinhos > Branco', name: 'Branco', image: 'photo-a' }]
    );
  });

  test('parses only valid products from a public tenant document', () => {
    const parsed = parsePublicProducts([
      {
        id: 'product-a',
        storeId: 'user-a',
        supplierId: 'user-a',
        name: 'Produto A',
        description: '',
        price: 10,
        image: '',
        stock: 2,
        category: 'Local > Artesanal',
        categoryCollections: [
          {
            path: 'Local > Artesanal',
            name: 'Artesanal',
            image: '/api/media/drive?fileId=artisan',
          },
        ],
        isService: false,
        updatedAt: '2026-07-21T00:00:00.000Z',
      },
      {
        id: 'invalid',
        storeId: '',
        supplierId: 'user-a',
        name: 'Inválido',
        price: 10,
        stock: 1,
        category: 'Local',
      },
    ]);

    assert.equal(parsed.length, 1);
    assert.equal(parsed[0]?.name, 'Produto A');
    assert.equal(parsed[0]?.storePointsPerUnit, 0);
    assert.deepEqual(parsed[0]?.categoryCollections, [
      {
        path: 'Local > Artesanal',
        name: 'Artesanal',
        image: '/api/media/drive?fileId=artisan',
      },
    ]);
  });
});
