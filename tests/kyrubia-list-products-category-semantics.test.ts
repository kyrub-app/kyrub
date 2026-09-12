import assert from 'node:assert/strict';
import test from 'node:test';
import type { KyrubErpContextSnapshot } from '../shared/kyrubErpContext';
import {
  executeKyrubiaSharedReadTool,
  type KyrubiaNormalizedToolCall,
} from '../server/ai/kyrubiaSharedToolExecutor';

const context = (): KyrubErpContextSnapshot => ({
  source: 'authenticated_client_snapshot',
  generatedAt: '2026-09-12T17:30:00.000Z',
  store: null,
  products: [
    {
      id: 'keychain-1',
      name: 'Chaveiro NFC',
      category: 'Chaveiros Artesanais',
      price: 20,
      stock: 12,
      isService: false,
      hasDescription: true,
      hasImage: true,
    },
    {
      id: 'coffee-1',
      name: 'Kit Café',
      category: 'Café & Acessórios',
      price: 45,
      stock: 6,
      isService: false,
      hasDescription: true,
      hasImage: true,
    },
    {
      id: 'other-1',
      name: 'Caneca',
      category: 'Presentes',
      price: 30,
      stock: 8,
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
    orders: false,
  },
  warnings: [],
});

const call = (
  name: string,
  args: Record<string, unknown>
): KyrubiaNormalizedToolCall => ({
  id: `test-${name}`,
  name,
  args,
});

const itemIds = (result: Record<string, unknown>): string[] =>
  Array.isArray(result.items)
    ? result.items.map(item => String((item as { id?: unknown }).id ?? ''))
    : [];

test('list_products category uses the same normalized contains semantics as query_products', () => {
  const snapshot = context();

  const legacyAlias = executeKyrubiaSharedReadTool(
    call('list_products', { category: 'chaveiro' }),
    snapshot
  );
  const genericQuery = executeKyrubiaSharedReadTool(
    call('query_products', { categoryContains: 'chaveiro' }),
    snapshot
  );

  assert.deepEqual(itemIds(legacyAlias), ['keychain-1']);
  assert.deepEqual(itemIds(genericQuery), ['keychain-1']);
});

test('list_products category matching is case- and diacritic-insensitive', () => {
  const result = executeKyrubiaSharedReadTool(
    call('list_products', { category: 'CAFE' }),
    context()
  );

  assert.deepEqual(itemIds(result), ['coffee-1']);
});

test('list_products search keeps partial matching with normalized catalog text', () => {
  const result = executeKyrubiaSharedReadTool(
    call('list_products', { search: 'acessorios' }),
    context()
  );

  assert.deepEqual(itemIds(result), ['coffee-1']);
});
