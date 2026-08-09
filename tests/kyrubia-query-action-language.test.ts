import assert from 'node:assert/strict';
import test from 'node:test';
import type { KyrubErpContextSnapshot } from '../shared/kyrubErpContext';
import { resolveKyrubiaDeterministicErpRead } from '../shared/kyrubiaDeterministicErp';
import {
  createKyrubiaProductQuery,
  executeKyrubiaProductQuery,
} from '../shared/kyrubiaQueryLanguage';

const erpSnapshot = (): KyrubErpContextSnapshot => ({
  source: 'authenticated_client_snapshot',
  generatedAt: '2026-08-09T17:00:00.000Z',
  store: {
    id: 'owner-1',
    name: 'Kyrub',
    description: 'Loja de teste',
    plan: 'business',
    status: 'open',
    address: '',
    keywords: [],
    configured: true,
  },
  products: [
    {
      id: 'p1',
      name: 'Produto A',
      category: 'Categoria A',
      price: 50,
      stock: 2,
      isService: false,
      hasDescription: true,
      hasImage: false,
    },
    {
      id: 'p2',
      name: 'Produto B',
      category: 'Categoria B',
      price: 120,
      stock: 8,
      isService: false,
      hasDescription: false,
      hasImage: false,
    },
    {
      id: 'p3',
      name: 'Produto C',
      category: 'Categoria C',
      price: 90,
      stock: 1,
      isService: false,
      hasDescription: false,
      hasImage: true,
    },
    {
      id: 's1',
      name: 'Serviço D',
      category: 'Serviços',
      price: 200,
      stock: 0,
      isService: true,
      hasDescription: true,
      hasImage: false,
    },
  ],
  productCount: 4,
  productsTruncated: false,
  pendingOrders: [],
  pendingOrderCount: 0,
  ordersTruncated: false,
  lowStockThreshold: 5,
  availability: {
    store: true,
    products: true,
    orders: true,
  },
  warnings: [],
});

test('product query language composes filters, sorting and limit without a phrase-specific tool', () => {
  const query = createKyrubiaProductQuery({
    filters: [
      { field: 'hasImage', operator: 'eq', value: false },
      { field: 'stock', operator: 'lte', value: 10 },
      { field: 'isService', operator: 'eq', value: false },
    ],
    sort: { field: 'price', direction: 'desc' },
    limit: 2,
  });

  const result = executeKyrubiaProductQuery(erpSnapshot(), query);

  assert.equal(result.available, true);
  assert.equal(result.totalMatched, 2);
  assert.deepEqual(result.items.map(item => item.id), ['p2', 'p1']);
  assert.equal(result.truncated, false);
});

test('missing-image note composition is deterministic and does not require Gemini', () => {
  const result = resolveKyrubiaDeterministicErpRead(
    'Crie uma nota com os produtos da minha loja Kyrub que estão sem imagem.',
    erpSnapshot()
  );

  assert.equal(result?.action, 'list_products');
  assert.equal(result?.noteDraft?.title, 'Produtos sem imagem');
  assert.match(result?.noteDraft?.content ?? '', /Produto A/);
  assert.match(result?.noteDraft?.content ?? '', /Produto B/);
  assert.match(result?.noteDraft?.content ?? '', /Serviço D/);
  assert.equal(result?.queryPlan?.filters.some(filter =>
    filter.field === 'hasImage' && filter.operator === 'eq' && filter.value === false
  ), true);
});

test('one deterministic compiler combines filters, ordering and limit', () => {
  const result = resolveKyrubiaDeterministicErpRead(
    'Liste os 2 produtos físicos mais caros sem imagem com estoque de até 10.',
    erpSnapshot()
  );

  assert.deepEqual(
    result?.turnContext?.entities.map(entity => entity.entityId),
    ['p2', 'p1']
  );
  assert.equal(result?.queryPlan?.sort?.field, 'price');
  assert.equal(result?.queryPlan?.sort?.direction, 'desc');
  assert.equal(result?.queryPlan?.limit, 2);
  assert.equal(result?.queryPlan?.filters.some(filter => filter.field === 'hasImage'), true);
  assert.equal(result?.queryPlan?.filters.some(filter => filter.field === 'stock'), true);
  assert.equal(result?.queryPlan?.filters.some(filter =>
    filter.field === 'isService' && filter.value === false
  ), true);
});

test('low stock continues to use the same generic executor while preserving compatibility', () => {
  const result = resolveKyrubiaDeterministicErpRead(
    'Liste os produtos com estoque baixo e salve isso em uma nota.',
    erpSnapshot()
  );

  assert.equal(result?.action, 'list_low_stock_products');
  assert.equal(result?.noteDraft?.title, 'Produtos com estoque baixo');
  assert.deepEqual(
    result?.turnContext?.entities.map(entity => entity.entityId),
    ['p3', 'p1']
  );
  assert.equal(result?.queryPlan?.filters.some(filter =>
    filter.field === 'stock' && filter.operator === 'lte' && filter.value === 5
  ), true);
});

test('open reasoning still stays outside the deterministic query compiler', () => {
  const result = resolveKyrubiaDeterministicErpRead(
    'Analise meus produtos sem imagem e recomende quais devo priorizar.',
    erpSnapshot()
  );

  assert.equal(result, null);
});
