import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import {
  buildPublicProduct,
  parsePublicProducts,
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
        category: 'Local',
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
  });
});
