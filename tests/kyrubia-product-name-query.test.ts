import assert from 'node:assert/strict';
import test from 'node:test';
import type { KyrubErpContextSnapshot } from '../shared/kyrubErpContext';
import { resolveKyrubiaDeterministicErpRead } from '../shared/kyrubiaDeterministicErp';

const snapshot = (): KyrubErpContextSnapshot => ({
  source: 'authenticated_client_snapshot',
  generatedAt: '2026-09-13T04:00:00.000Z',
  store: null,
  products: [
    {
      id: 'key-acrylic',
      name: 'Chaveiro Acrílico',
      category: 'Chaveiros',
      price: 20,
      stock: 5,
      isService: false,
      hasDescription: true,
      hasImage: true,
    },
    {
      id: 'key-mdf',
      name: 'Chaveiro Kyrub MDF',
      category: 'Acessórios',
      price: 20,
      stock: 5,
      isService: false,
      hasDescription: true,
      hasImage: true,
    },
    {
      id: 'cup',
      name: 'Caneca Kyrub',
      category: 'Canecas',
      price: 30,
      stock: 3,
      isService: false,
      hasDescription: true,
      hasImage: true,
    },
  ],
  productCount: 3,
  productsTruncated: false,
  pendingOrders: [],
  pendingOrderCount: 0,
  ordersTruncated: false,
  lowStockThreshold: 5,
  availability: {
    store: false,
    products: true,
    orders: true,
  },
  warnings: [],
});

test('product name query does not fall through to unavailable store profile data', () => {
  const result = resolveKyrubiaDeterministicErpRead(
    'Quais produtos da minha loja têm “chaveiro” no nome e em quais categorias eles estão cadastrados?',
    snapshot()
  );

  assert.equal(result?.action, 'list_products');
  assert.equal(result?.queryPlan?.filters.some(filter =>
    filter.field === 'name' && filter.operator === 'contains' && filter.value === 'chaveiro'
  ), true);
  assert.deepEqual(
    result?.turnContext?.entities.map(entity => entity.entityId),
    ['key-acrylic', 'key-mdf']
  );
  assert.match(result?.reply ?? '', /Chaveiro Acrílico — Chaveiros/);
  assert.match(result?.reply ?? '', /Chaveiro Kyrub MDF — Acessórios/);
  assert.doesNotMatch(result?.reply ?? '', /dados da sua loja estão temporariamente indisponíveis/i);
});
