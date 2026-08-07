import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import kyrubiaHandler from '../api/kyrubia';
import type { KyrubErpContextSnapshot } from '../shared/kyrubErpContext';
import { resolveKyrubiaDeterministicErpRead } from '../shared/kyrubiaDeterministicErp';
import { normalizeConsultantError } from '../src/ai/consultantError';

const createResponse = () => {
  let statusCode = 0;
  let responseBody: unknown = null;
  const headers = new Map<string, string>();
  const response = {
    setHeader(name: string, value: string) {
      headers.set(name.toLowerCase(), value);
    },
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
    read: () => ({ statusCode, responseBody, headers }),
  };
};

const erpSnapshot = (): KyrubErpContextSnapshot => ({
  source: 'authenticated_client_snapshot',
  generatedAt: '2026-08-07T06:00:00.000Z',
  store: {
    id: 'owner-1',
    name: 'Pet Kyrub',
    description: 'Pet shop',
    plan: 'business',
    status: 'open',
    address: 'Rua Exemplo',
    keywords: ['pet'],
    configured: true,
  },
  products: [
    {
      id: 'product-low',
      name: 'Ração Premium',
      category: 'Rações',
      price: 89.9,
      stock: 3,
      isService: false,
      hasDescription: true,
      hasImage: true,
    },
    {
      id: 'product-ok',
      name: 'Brinquedo',
      category: 'Brinquedos',
      price: 29.9,
      stock: 18,
      isService: false,
      hasDescription: false,
      hasImage: false,
    },
    {
      id: 'service-bath',
      name: 'Banho',
      category: 'Serviços',
      price: 60,
      stock: 0,
      isService: true,
      hasDescription: true,
      hasImage: false,
    },
  ],
  productCount: 3,
  productsTruncated: false,
  pendingOrders: [{
    id: 'order-1',
    status: 'preparing',
    paymentStatus: 'paid',
    fulfillmentType: 'delivery',
    total: 119.8,
    itemCount: 2,
    createdAt: '2026-08-07T05:00:00.000Z',
  }],
  pendingOrderCount: 1,
  ordersTruncated: false,
  lowStockThreshold: 5,
  availability: {
    store: true,
    products: true,
    orders: true,
  },
  warnings: [],
});

test('Kyrubia health advertises ERP reads separately from write actions', async () => {
  const capture = createResponse();

  await kyrubiaHandler(
    { method: 'GET', headers: {} },
    capture.response
  );

  const { statusCode, responseBody } = capture.read();
  assert.equal(statusCode, 200);
  const body = responseBody as Record<string, any>;
  assert.deepEqual(body.enabledActions, ['create_note']);
  assert.deepEqual(body.enabledReadActions, [
    'read_store_summary',
    'list_products',
    'list_low_stock_products',
    'list_pending_orders',
  ]);
});

test('Kyrubia runtime resolves simple ERP reads without generative reasoning', () => {
  const context = erpSnapshot();

  const count = resolveKyrubiaDeterministicErpRead(
    'Quantos produtos tenho cadastrados?',
    context
  );
  assert.equal(count?.action, 'read_store_summary');
  assert.match(count?.reply ?? '', /3 itens cadastrados/);

  const lowStock = resolveKyrubiaDeterministicErpRead(
    'Liste os produtos com estoque baixo da minha loja Kyrub',
    context
  );
  assert.equal(lowStock?.action, 'list_low_stock_products');
  assert.match(lowStock?.reply ?? '', /Ração Premium/);
  assert.doesNotMatch(lowStock?.reply ?? '', /Banho/);

  const pending = resolveKyrubiaDeterministicErpRead(
    'Tenho pedidos pendentes?',
    context
  );
  assert.equal(pending?.action, 'list_pending_orders');
  assert.match(pending?.reply ?? '', /1 pedido pendente/);

  const missingDescription = resolveKyrubiaDeterministicErpRead(
    'Liste meus produtos sem descrição.',
    context
  );
  assert.equal(missingDescription?.action, 'list_products');
  assert.match(missingDescription?.reply ?? '', /Brinquedo/);
  assert.doesNotMatch(missingDescription?.reply ?? '', /Ração Premium/);

  const missingImage = resolveKyrubiaDeterministicErpRead(
    'Quais produtos estão sem imagem?',
    context
  );
  assert.equal(missingImage?.action, 'list_products');
  assert.match(missingImage?.reply ?? '', /Brinquedo/);
  assert.match(missingImage?.reply ?? '', /Banho/);
});

test('compound ERP requests still defer to the reasoning and proposal flow', () => {
  const result = resolveKyrubiaDeterministicErpRead(
    'Liste os produtos com estoque baixo e salve isso em uma nota.',
    erpSnapshot()
  );

  assert.equal(result, null);
});

test('provider quota is not presented as a Kyrubia product usage limit', () => {
  const normalized = normalizeConsultantError({
    code: 'AI_QUOTA_EXCEEDED',
    error: 'O limite de uso da Kyrubia foi atingido. Tente novamente mais tarde.',
  });

  assert.equal(normalized.code, 'AI_QUOTA_EXCEEDED');
  assert.match(normalized.message, /limite do provedor/i);
  assert.match(normalized.message, /não dependem de IA continuam disponíveis/i);
  assert.doesNotMatch(normalized.message, /limite de uso da Kyrubia/i);
});

test('Kyrubia answers low-stock questions from the authenticated ERP snapshot', async () => {
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
      assert.ok(names.includes('create_note'));
      assert.ok(names.includes('list_low_stock_products'));
      assert.ok(names.includes('list_pending_orders'));

      return Response.json({
        candidates: [{
          content: {
            role: 'model',
            parts: [{
              functionCall: {
                id: 'read-low-stock-1',
                name: 'list_low_stock_products',
                args: { threshold: 5, limit: 10 },
              },
            }],
          },
        }],
      });
    }

    const responsePart = body.contents
      ?.at(-1)
      ?.parts?.[0]
      ?.functionResponse;
    assert.equal(responsePart?.name, 'list_low_stock_products');
    assert.equal(responsePart?.response?.available, true);
    assert.equal(responsePart?.response?.threshold, 5);
    assert.deepEqual(
      responsePart?.response?.items?.map((item: Record<string, unknown>) => item.id),
      ['product-low']
    );
    assert.equal(
      JSON.stringify(responsePart?.response).includes('buyerEmail'),
      false
    );

    return Response.json({
      candidates: [{
        content: {
          role: 'model',
          parts: [{
            text: 'Há 1 produto com estoque baixo: Ração Premium, com 3 unidades.',
          }],
        },
      }],
    });
  };

  const capture = createResponse();
  try {
    const snapshot = erpSnapshot();
    snapshot.pendingOrders = [];
    snapshot.pendingOrderCount = 0;
    snapshot.products[1] = {
      ...snapshot.products[1],
      hasDescription: true,
      hasImage: true,
    };

    await kyrubiaHandler(
      {
        method: 'POST',
        headers: { authorization: 'Bearer firebase-token' },
        body: {
          conversationId: 'conversation-erp-1',
          topic: 'Minha loja',
          messages: [{
            role: 'user',
            content: 'Quais produtos estão com estoque baixo?',
          }],
          erpContext: snapshot,
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
  const result = responseBody as Record<string, any>;
  assert.match(result.reply, /Ração Premium/);
  assert.equal(result.actionProposal, undefined);
  assert.deepEqual(result.capabilities.enabledActions, ['create_note']);
  assert.ok(
    result.capabilities.enabledReadActions.includes('list_low_stock_products')
  );
});

test('ERP reads are bounded, sanitized and remain separate from mutations', async () => {
  const [
    routeSource,
    clientSource,
    readServiceSource,
    actionProtocolSource,
    sharedSource,
    deterministicSource,
  ] = await Promise.all([
    readFile(new URL('../api/kyrubia.ts', import.meta.url), 'utf8'),
    readFile(new URL('../src/ai/consultantClient.ts', import.meta.url), 'utf8'),
    readFile(new URL('../src/actions/erpReadActionService.ts', import.meta.url), 'utf8'),
    readFile(new URL('../shared/kyrubActions.ts', import.meta.url), 'utf8'),
    readFile(new URL('../shared/aiConsultant.ts', import.meta.url), 'utf8'),
    readFile(new URL('../shared/kyrubiaDeterministicErp.ts', import.meta.url), 'utf8'),
  ]);

  assert.match(clientSource, /readKyrubErpContext/);
  assert.match(clientSource, /resolveKyrubiaDeterministicErpRead/);
  assert.match(clientSource, /provider: 'kyrub'/);
  assert.match(clientSource, /mode: 'deterministic'/);
  assert.match(clientSource, /erpContext/);
  assert.match(readServiceSource, /getPrimaryUserStoreDocumentPath\(user\.uid\)/);
  assert.match(readServiceSource, /doc\(db, 'tenants', user\.uid\)/);
  assert.match(readServiceSource, /MAX_PRODUCTS_IN_CONTEXT = 120/);
  assert.match(readServiceSource, /MAX_PENDING_ORDERS_IN_CONTEXT = 30/);
  assert.doesNotMatch(readServiceSource, /buyerEmail:/);
  assert.doesNotMatch(readServiceSource, /buyerName:/);
  assert.doesNotMatch(readServiceSource, /deliveryAddress:/);

  assert.match(actionProtocolSource, /READ_STORE_SUMMARY: 'read_store_summary'/);
  assert.match(actionProtocolSource, /LIST_PRODUCTS: 'list_products'/);
  assert.match(actionProtocolSource, /LIST_LOW_STOCK_PRODUCTS/);
  assert.match(actionProtocolSource, /LIST_PENDING_ORDERS/);
  assert.match(actionProtocolSource, /mode: 'read'/);
  assert.match(actionProtocolSource, /requiresConfirmation: false/);
  assert.match(actionProtocolSource, /permission: 'orders\.read'/);

  assert.match(routeSource, /ERP_READ_DECLARATIONS/);
  assert.match(routeSource, /executeErpReadAction/);
  assert.match(routeSource, /enabledReadActions: ERP_READ_ACTIONS/);
  assert.doesNotMatch(routeSource, /from ['"]firebase\/firestore['"]/);
  assert.doesNotMatch(routeSource, /setDoc\(/);
  assert.doesNotMatch(routeSource, /updateDoc\(/);
  assert.doesNotMatch(routeSource, /deleteDoc\(/);

  assert.match(sharedSource, /erpContext\?: KyrubErpContextSnapshot/);
  assert.match(sharedSource, /provider: 'kyrub' \| 'gemini'/);
  assert.match(sharedSource, /mode: 'conversation' \| 'deterministic'/);
  assert.match(sharedSource, /enabledReadActions\?: KyrubReadActionType\[\]/);

  assert.match(deterministicSource, /NEEDS_REASONING_OR_MUTATION/);
  assert.match(deterministicSource, /list_low_stock_products/);
  assert.match(deterministicSource, /list_pending_orders/);
});