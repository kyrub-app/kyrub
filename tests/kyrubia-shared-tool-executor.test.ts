import assert from 'node:assert/strict';
import test from 'node:test';
import {
  executeKyrubiaSharedReadTool,
  isKyrubiaErpReadTool,
  kyrubiaCreateNoteProposalFromCall,
  normalizeKyrubiaToolArguments,
  KYRUBIA_ALL_TOOLS,
  type KyrubiaErpSnapshot,
} from '../server/ai/kyrubiaSharedToolExecutor.js';

const snapshot: KyrubiaErpSnapshot = {
  generatedAt: '2026-08-23T00:00:00.000Z',
  store: { id: 'store-1', name: 'Loja' },
  products: [
    {
      id: 'p1',
      name: 'X-Burger',
      category: 'Burgers',
      price: 29.5,
      stock: 8,
      isService: false,
      hasDescription: true,
      hasImage: true,
    },
    {
      id: 'p2',
      name: 'Batata',
      category: 'Porções',
      price: 18,
      stock: 2,
      isService: false,
      hasDescription: true,
      hasImage: false,
    },
  ],
  productCount: 2,
  productsTruncated: false,
  pendingOrders: [{ id: 'o1', status: 'pending' }],
  pendingOrderCount: 1,
  ordersTruncated: false,
  lowStockThreshold: 5,
  availability: { store: true, products: true, orders: true },
  warnings: [],
};

test('shared declaration set preserves note, generic product query and ERP read tools', () => {
  const names = KYRUBIA_ALL_TOOLS.functionDeclarations.map(tool => tool.name);
  assert.deepEqual(names, [
    'create_note',
    'query_products',
    'read_store_summary',
    'list_products',
    'list_low_stock_products',
    'list_pending_orders',
  ]);
});

test('shared ERP executor preserves list and low-stock behavior', () => {
  const listed = executeKyrubiaSharedReadTool(
    { id: '1', name: 'list_products', args: { search: 'burger' } },
    snapshot
  );
  assert.equal(listed.available, true);
  assert.equal(listed.returned, 1);
  assert.equal((listed.items as Array<{ id: string }>)[0]?.id, 'p1');

  const low = executeKyrubiaSharedReadTool(
    { id: '2', name: 'list_low_stock_products', args: {} },
    snapshot
  );
  assert.equal(low.available, true);
  assert.equal(low.returned, 1);
  assert.equal((low.items as Array<{ id: string }>)[0]?.id, 'p2');
});

test('shared generic product query combines filters deterministically', () => {
  const result = executeKyrubiaSharedReadTool(
    {
      id: '3',
      name: 'query_products',
      args: { hasImage: true, stockMin: 5, sortBy: 'price', sortDirection: 'desc' },
    },
    snapshot
  );
  assert.equal(result.available, true);
  assert.equal(result.totalMatched, 1);
  assert.equal((result.items as Array<{ id: string }>)[0]?.id, 'p1');
});

test('shared note proposal remains proposal-only and requires confirmation', () => {
  const proposal = kyrubiaCreateNoteProposalFromCall({
    id: 'note-1',
    name: 'create_note',
    args: { title: 'Teste', content: 'Conteúdo', checklist: ['Revisar'] },
  });
  assert.equal(proposal?.type, 'create_note');
  assert.equal(proposal?.requiresConfirmation, true);
  assert.deepEqual(proposal?.checklist, ['Revisar']);
});

test('shared argument parser and read-tool guard reject invented semantics', () => {
  assert.deepEqual(normalizeKyrubiaToolArguments('{"limit":5}'), { limit: 5 });
  assert.equal(isKyrubiaErpReadTool('list_products'), true);
  assert.equal(isKyrubiaErpReadTool('mutate_inventory'), false);
  assert.deepEqual(
    executeKyrubiaSharedReadTool(
      { id: '4', name: 'mutate_inventory', args: {} },
      snapshot
    ),
    { available: false, reason: 'unknown_read_action' }
  );
});
