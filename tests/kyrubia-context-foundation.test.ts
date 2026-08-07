import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import type { KyrubErpContextSnapshot } from '../shared/kyrubErpContext';
import { resolveKyrubiaDeterministicErpRead } from '../shared/kyrubiaDeterministicErp';
import {
  describeKyrubiaTurnSelection,
  resolveKyrubiaContextualRecall,
  resolveKyrubiaTurnSelection,
} from '../shared/kyrubiaContext';

const snapshot = (): KyrubErpContextSnapshot => ({
  source: 'authenticated_client_snapshot',
  generatedAt: '2026-08-07T19:00:00.000Z',
  store: {
    id: 'store-owner-1',
    name: 'Loja Kyrub',
    description: '',
    plan: 'business',
    status: 'open',
    address: '',
    keywords: [],
    configured: true,
  },
  products: [
    {
      id: 'product-a',
      name: 'Produto A',
      category: 'Categoria',
      price: 100,
      stock: 0,
      isService: false,
      hasDescription: true,
      hasImage: true,
    },
    {
      id: 'product-b',
      name: 'Produto B',
      category: 'Categoria',
      price: 80,
      stock: 1,
      isService: false,
      hasDescription: true,
      hasImage: true,
    },
    {
      id: 'product-c',
      name: 'Produto C',
      category: 'Categoria',
      price: 60,
      stock: 2,
      isService: false,
      hasDescription: true,
      hasImage: true,
    },
    {
      id: 'product-d',
      name: 'Produto D',
      category: 'Categoria',
      price: 40,
      stock: 3,
      isService: false,
      hasDescription: true,
      hasImage: true,
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

test('ERP list responses retain structured entity identity and display order', () => {
  const result = resolveKyrubiaDeterministicErpRead(
    'Liste os produtos com estoque baixo.',
    snapshot()
  );

  assert.ok(result?.turnContext);
  assert.equal(result.turnContext.scope.kind, 'own_store');
  assert.equal(result.turnContext.scope.storeId, 'store-owner-1');
  assert.deepEqual(
    result.turnContext.entities.map(entity => ({
      id: entity.entityId,
      position: entity.position,
    })),
    [
      { id: 'product-a', position: 1 },
      { id: 'product-b', position: 2 },
      { id: 'product-c', position: 3 },
      { id: 'product-d', position: 4 },
    ]
  );

  const serialized = JSON.stringify(result.turnContext);
  assert.doesNotMatch(serialized, /"price"/);
  assert.doesNotMatch(serialized, /"stock"/);
});

test('contextual follow-up resolves the first three real entities without guessing names', () => {
  const list = resolveKyrubiaDeterministicErpRead(
    'Liste os produtos com estoque baixo.',
    snapshot()
  );
  assert.ok(list?.turnContext);

  const selection = resolveKyrubiaTurnSelection(
    'Dessa lista que você acabou de me mostrar, aplique um desconto de 10% nos três primeiros itens.',
    list.turnContext
  );

  assert.deepEqual(selection?.entityIds, [
    'product-a',
    'product-b',
    'product-c',
  ]);
  assert.equal(selection?.resolution, 'first_n');
  assert.equal(selection?.entityType, 'product');
});

test('contextual recall can answer which items were shown without generative AI', () => {
  const list = resolveKyrubiaDeterministicErpRead(
    'Liste os produtos com estoque baixo.',
    snapshot()
  );
  assert.ok(list?.turnContext);

  const recall = resolveKyrubiaContextualRecall(
    'Dessa lista, quais são os dois primeiros?',
    list.turnContext
  );

  assert.ok(recall);
  assert.deepEqual(recall.selection.entityIds, ['product-a', 'product-b']);
  assert.match(recall.reply, /Produto A/);
  assert.match(recall.reply, /Produto B/);
  assert.doesNotMatch(recall.reply, /100|80|estoque|preço/i);
  assert.deepEqual(
    recall.turnContext.entities.map(entity => ({
      id: entity.entityId,
      position: entity.position,
    })),
    [
      { id: 'product-a', position: 1 },
      { id: 'product-b', position: 2 },
    ]
  );
});

test('mutation wording is resolved as reference but is not intercepted as a readback', () => {
  const list = resolveKyrubiaDeterministicErpRead(
    'Liste os produtos com estoque baixo.',
    snapshot()
  );
  assert.ok(list?.turnContext);
  const message =
    'Dessa lista que você acabou de me mostrar, aplique um desconto de 10% nos três primeiros itens.';

  assert.ok(resolveKyrubiaTurnSelection(message, list.turnContext));
  assert.equal(resolveKyrubiaContextualRecall(message, list.turnContext), null);
});

test('turn memory is not used when the user does not refer to the previous result', () => {
  const list = resolveKyrubiaDeterministicErpRead(
    'Liste os produtos com estoque baixo.',
    snapshot()
  );
  assert.ok(list?.turnContext);

  const selection = resolveKyrubiaTurnSelection(
    'Aplique um desconto em três produtos.',
    list.turnContext
  );

  assert.equal(selection, null);
});

test('structured reference explicitly remains context rather than authorization or truth', () => {
  const list = resolveKyrubiaDeterministicErpRead(
    'Liste os produtos com estoque baixo.',
    snapshot()
  );
  assert.ok(list?.turnContext);
  const selection = resolveKyrubiaTurnSelection(
    'Dessa lista, use os dois primeiros.',
    list.turnContext
  );
  assert.ok(selection);

  const description = describeKyrubiaTurnSelection(selection);
  assert.match(description, /Referência operacional resolvida pelo Kyrub/i);
  assert.match(description, /não prova estado atual/i);
  assert.match(description, /(?:não|nem) autoriza mutações/i);
});

test('workspace persists the latest structured turn and uses activate-store wording', async () => {
  const [workspace, conversationStore, client] = await Promise.all([
    readFile(new URL('../src/components/KyrubAiWorkspaceBridge.tsx', import.meta.url), 'utf8'),
    readFile(new URL('../src/ai/conversationStore.ts', import.meta.url), 'utf8'),
    readFile(new URL('../src/ai/consultantClient.ts', import.meta.url), 'utf8'),
  ]);

  assert.match(workspace, /title: 'Ativar minha loja'/);
  assert.match(workspace, /turnContext: conversation\.lastTurnContext/);
  assert.match(workspace, /lastTurnContext: result\.turnContext/);
  assert.match(conversationStore, /lastTurnContext\?: KyrubiaTurnContext/);
  assert.match(client, /resolveKyrubiaTurnSelection/);
  assert.match(client, /resolveKyrubiaContextualRecall/);
  assert.match(client, /describeKyrubiaTurnSelection/);
  assert.match(client, /screenContext: appendStructuredReferenceContext/);
  assert.match(client, /provider: 'kyrub'/);
  assert.match(client, /mode: 'deterministic'/);
});
