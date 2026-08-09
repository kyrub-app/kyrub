import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import kyrubiaHandler from '../api/kyrubia';
import type { KyrubErpContextSnapshot } from '../shared/kyrubErpContext';
import { resolveKyrubiaDeterministicErpRead } from '../shared/kyrubiaDeterministicErp';
import { routeKyrubiaLocalProductIntent } from '../shared/kyrubiaIntentRouter';
import {
  createKyrubiaProductQuery,
  executeKyrubiaProductQuery,
} from '../shared/kyrubiaQueryLanguage';

const createResponse = () => {
  let statusCode = 0;
  let responseBody: unknown = null;
  const response = {
    setHeader() {},
    status(code: number) {
      statusCode = code;
      return response;
    },
    json(body: unknown) {
      responseBody = body;
    },
  };
  return {
    response,
    read: () => ({ statusCode, responseBody }),
  };
};

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

test('local intent router composes paraphrases from domain concepts instead of exact commands', () => {
  const routed = routeKyrubiaLocalProductIntent(
    'Dos produtos sem foto, registra numa nota os três de maior valor que possuem no máximo dez unidades.'
  );

  assert.ok(routed);
  assert.equal(routed.saveAsNote, true);
  assert.equal(routed.limit, 3);
  assert.deepEqual(routed.sort, { field: 'price', direction: 'desc' });
  assert.equal(routed.filters.some(filter =>
    filter.field === 'hasImage' && filter.operator === 'eq' && filter.value === false
  ), true);
  assert.equal(routed.filters.some(filter =>
    filter.field === 'stock' && filter.operator === 'lte' && filter.value === 10
  ), true);
  assert.ok(routed.matchedConcepts.includes('compose:create_note'));
});

test('local intent router keeps boolean operators attached to the correct field', () => {
  const result = resolveKyrubiaDeterministicErpRead(
    'Mostra os produtos sem descrição e com imagem.',
    erpSnapshot()
  );

  assert.deepEqual(
    result?.turnContext?.entities.map(entity => entity.entityId),
    ['p3']
  );
  assert.equal(result?.queryPlan?.filters.some(filter =>
    filter.field === 'hasDescription' && filter.value === false
  ), true);
  assert.equal(result?.queryPlan?.filters.some(filter =>
    filter.field === 'hasImage' && filter.value === true
  ), true);
});

test('one local intent router combines filters, ordering and limit', () => {
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

test('local intent router scopes contextual filters to previously shown product IDs', () => {
  const first = resolveKyrubiaDeterministicErpRead(
    'Liste os produtos sem imagem.',
    erpSnapshot()
  );
  assert.ok(first?.turnContext);

  const second = resolveKyrubiaDeterministicErpRead(
    'Desses, quais continuam sem imagem?',
    erpSnapshot(),
    first.turnContext
  );

  assert.deepEqual(
    second?.queryPlan?.candidateIds,
    first.turnContext.entities.map(entity => entity.entityId)
  );
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

test('open reasoning still stays outside the local intent router', () => {
  const result = resolveKyrubiaDeterministicErpRead(
    'Analise meus produtos sem imagem e recomende quais devo priorizar.',
    erpSnapshot()
  );

  assert.equal(result, null);
});

test('quota-first contract keeps local routing before consultant network calls', async () => {
  const [clientSource, routerSource] = await Promise.all([
    readFile(new URL('../src/ai/consultantClient.ts', import.meta.url), 'utf8'),
    readFile(new URL('../shared/kyrubiaIntentRouter.ts', import.meta.url), 'utf8'),
  ]);

  const deterministicIndex = clientSource.indexOf('const deterministic =');
  const deterministicReturnIndex = clientSource.indexOf('if (deterministic)', deterministicIndex);
  const networkIndex = clientSource.indexOf('for (const [index, endpoint]');

  assert.ok(deterministicIndex >= 0);
  assert.ok(deterministicReturnIndex > deterministicIndex);
  assert.ok(networkIndex > deterministicReturnIndex);
  assert.doesNotMatch(routerSource, /generativelanguage|GEMINI_API_KEY|fetch\(/);
});

test('generative ERP reasoning uses one generic query_products tool and Kyrub executes the plan', async () => {
  const originalFetch = globalThis.fetch;
  const originalApiKey = process.env.GEMINI_API_KEY;
  const geminiBodies: Array<Record<string, any>> = [];

  process.env.GEMINI_API_KEY = 'gemini-test-key';
  globalThis.fetch = async (input, init) => {
    const url = String(input);
    const body = typeof init?.body === 'string'
      ? JSON.parse(init.body) as Record<string, any>
      : {};

    if (url.includes('identitytoolkit.googleapis.com')) {
      return Response.json({
        users: [{
          localId: 'owner-1',
          email: 'owner@example.com',
          displayName: 'Dona da Loja',
        }],
      });
    }

    assert.match(url, /generativelanguage\.googleapis\.com/);
    geminiBodies.push(body);

    if (geminiBodies.length === 1) {
      const declarations = body.tools?.[0]?.functionDeclarations ?? [];
      const names = declarations.map((item: Record<string, unknown>) => item.name);
      assert.ok(names.includes('query_products'));
      assert.equal(names.includes('list_products_without_images'), false);

      return Response.json({
        candidates: [{
          content: {
            role: 'model',
            parts: [{
              functionCall: {
                id: 'generic-product-query-1',
                name: 'query_products',
                args: {
                  hasImage: false,
                  isService: false,
                  stockMax: 10,
                  sortBy: 'price',
                  sortDirection: 'desc',
                  limit: 2,
                },
              },
            }],
          },
        }],
      });
    }

    const responsePart = body.contents?.at(-1)?.parts?.[0]?.functionResponse;
    assert.equal(responsePart?.name, 'query_products');
    assert.equal(responsePart?.response?.available, true);
    assert.equal(responsePart?.response?.totalMatched, 2);
    assert.deepEqual(
      responsePart?.response?.items?.map((item: Record<string, unknown>) => item.id),
      ['p2', 'p1']
    );
    assert.equal(responsePart?.response?.query?.filters?.length, 3);
    assert.equal(responsePart?.response?.query?.sort?.field, 'price');

    return Response.json({
      candidates: [{
        content: {
          role: 'model',
          parts: [{
            text: 'Os dois produtos físicos mais caros sem imagem e com estoque até 10 são Produto B e Produto A.',
          }],
        },
      }],
    });
  };

  const capture = createResponse();
  try {
    await kyrubiaHandler(
      {
        method: 'POST',
        headers: { authorization: 'Bearer firebase-token' },
        body: {
          conversationId: 'conversation-query-language-1',
          topic: 'Minha loja',
          messages: [{
            role: 'user',
            content: 'Analise meu catálogo e me diga quais são os dois produtos mais caros sem imagem e com estoque até 10.',
          }],
          erpContext: erpSnapshot(),
        },
      },
      capture.response
    );
  } finally {
    globalThis.fetch = originalFetch;
    if (originalApiKey === undefined) delete process.env.GEMINI_API_KEY;
    else process.env.GEMINI_API_KEY = originalApiKey;
  }

  const { statusCode, responseBody } = capture.read();
  assert.equal(statusCode, 200);
  assert.equal(geminiBodies.length, 2);
  assert.match((responseBody as Record<string, any>).reply, /Produto B/);
});
