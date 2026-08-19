import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import type { KyrubErpContextSnapshot } from '../shared/kyrubErpContext';
import { resolveActivePlanProductCapacity } from '../src/ai/activePlanProductCapacity';
import { isKyrubAiActionProposal } from '../src/ai/actionEvents';
import {
  parseKyrubiaProductNameUpdate,
  parseKyrubiaProductUpdate,
  resolveKyrubiaDeterministicProductUpdate,
} from '../src/ai/deterministicProductUpdate';
import {
  describeKyrubiaPlanContextForGenerative,
  resolveKyrubiaPlanConversation,
} from '../src/ai/planConversationRuntime';

const context = (plan: 'free' | 'pro' = 'pro'): KyrubErpContextSnapshot => ({
  source: 'authenticated_client_snapshot',
  generatedAt: '2026-08-12T23:00:00.000Z',
  store: {
    id: 'owner-product-update',
    name: 'Loja Teste',
    description: '',
    plan,
    status: 'closed',
    address: '',
    keywords: ['teste'],
    configured: true,
  },
  products: [
    {
      id: 'product-pro-test',
      name: 'Produto Pro de Teste',
      category: 'Testes',
      price: 10,
      stock: 1,
      isService: false,
      hasDescription: false,
      hasImage: false,
    },
  ],
  productCount: plan === 'free' ? 5 : 6,
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

test('explicit product rename parses the exact user command even without a closing quote', () => {
  assert.deepEqual(
    parseKyrubiaProductNameUpdate(
      'Altere o nome do produto "Produto Pro de Teste" para "testando alteração pela kyrubia'
    ),
    {
      currentName: 'Produto Pro de Teste',
      nextName: 'testando alteração pela kyrubia',
    }
  );
});

test('explicit product rename resolves the authoritative item and proposes only update_product', () => {
  const result = resolveKyrubiaDeterministicProductUpdate(
    'Altere o nome do produto "Produto Pro de Teste" para "testando alteração pela kyrubia"',
    context('pro')
  );

  assert.equal(result?.actionProposal?.type, 'update_product');
  assert.equal(result?.actionProposal?.productId, 'product-pro-test');
  assert.equal(result?.actionProposal?.expectedCurrentName, 'Produto Pro de Teste');
  assert.deepEqual(result?.actionProposal?.patch, {
    name: 'testando alteração pela kyrubia',
  });
  assert.equal(result?.actionProposal?.requiresConfirmation, true);
  assert.equal(result?.actionProposal?.inputProvenance, 'user_intent');
  assert.match(result?.reply ?? '', /Revise e confirme/i);
});

test('explicit product price edit is deterministic and converts BRL decimal notation', () => {
  assert.deepEqual(
    parseKyrubiaProductUpdate(
      'Altere o preço do produto "Produto Pro de Teste" para R$ 39,90'
    ),
    {
      currentName: 'Produto Pro de Teste',
      field: 'price',
      value: 39.9,
    }
  );
  const result = resolveKyrubiaDeterministicProductUpdate(
    'Altere o preço do produto "Produto Pro de Teste" para R$ 39,90',
    context('pro')
  );
  assert.deepEqual(result?.actionProposal?.patch, { price: 39.9 });
  assert.match(result?.reply ?? '', /preço/i);
  assert.match(result?.reply ?? '', /39,90/);
});

test('explicit product category edit targets only the requested field', () => {
  const result = resolveKyrubiaDeterministicProductUpdate(
    'Atualize a categoria do produto "Produto Pro de Teste" para Promoções',
    context('pro')
  );
  assert.deepEqual(result?.actionProposal?.patch, { category: 'Promoções' });
});

test('browser confirmation gate accepts rich update_product proposals and rejects inventory leakage', () => {
  const base = {
    id: 'update-product-pro-test',
    type: 'update_product',
    productId: 'product-pro-test',
    expectedCurrentName: 'Produto Pro de Teste',
    requiresConfirmation: true,
    origin: 'kyrubia',
    risk: 'medium',
    inputProvenance: 'user_intent',
    impact: { entityCount: 1, reversibility: 'limited' },
  } as const;

  assert.equal(isKyrubAiActionProposal({ ...base, patch: { price: 39.9 } }), true);
  assert.equal(isKyrubAiActionProposal({ ...base, patch: { description: '' } }), true);
  assert.equal(isKyrubAiActionProposal({ ...base, patch: { category: 'Promoções' } }), true);
  assert.equal(isKyrubAiActionProposal({ ...base, patch: { image: '' } }), true);
  assert.equal(isKyrubAiActionProposal({ ...base, patch: { stock: 99 } }), false);
  assert.equal(isKyrubAiActionProposal({ ...base, patch: { price: -1 } }), false);
});

test('a product named Pro never turns a product edit into a plan conversation', () => {
  const messages = [
    {
      role: 'user' as const,
      content:
        'Altere o preço do produto "Produto Pro de Teste" para R$ 39,90',
    },
  ];

  assert.equal(resolveKyrubiaPlanConversation(messages, context('pro')), null);
  assert.equal(describeKyrubiaPlanContextForGenerative(messages), null);
});

test('catalog capacity does not block editing an existing product even when Free is full', () => {
  const result = resolveActivePlanProductCapacity(
    'Altere o nome do produto "Produto Pro de Teste" para "Novo Nome"',
    context('free'),
    null
  );

  assert.equal(result.reply, null);
  assert.equal(result.bypassLegacyFreeCapacity, false);
});

test('product update contract stays confirmation-bound, rich and server-authoritative', async () => {
  const [
    sharedSource,
    wrapperSource,
    executionSource,
    facadeSource,
    apiSource,
    routerSource,
    bridgeSource,
    actionEventsSource,
    appSource,
  ] = await Promise.all([
    readFile(new URL('../shared/kyrubActions.ts', import.meta.url), 'utf8'),
    readFile(new URL('../src/ai/consultantClientWithPlans.ts', import.meta.url), 'utf8'),
    readFile(new URL('../server/actions/productUpdateExecutionService.ts', import.meta.url), 'utf8'),
    readFile(new URL('../server/actions/actionExecutionFacade.ts', import.meta.url), 'utf8'),
    readFile(new URL('../api/action-execute.ts', import.meta.url), 'utf8'),
    readFile(new URL('../server/actions/actionExecutionRouter.ts', import.meta.url), 'utf8'),
    readFile(new URL('../src/components/KyrubAiProductUpdateActionBridge.tsx', import.meta.url), 'utf8'),
    readFile(new URL('../src/ai/actionEvents.ts', import.meta.url), 'utf8'),
    readFile(new URL('../src/App.tsx', import.meta.url), 'utf8'),
  ]);

  assert.match(sharedSource, /UPDATE_PRODUCT:\s*'update_product'/);
  assert.match(sharedSource, /export type KyrubProductPatch = \{[\s\S]*description\?: string[\s\S]*price\?: number[\s\S]*category\?: string[\s\S]*image\?: string/);
  assert.match(sharedSource, /update_product:\s*\{[\s\S]*requiresConfirmation:\s*true/);
  assert.match(sharedSource, /permission:\s*'products\.write'/);

  assert.match(wrapperSource, /isKyrubiaDeterministicProductUpdateIntent/);
  assert.match(wrapperSource, /kyrub-product-update-runtime-v1/);
  assert.match(wrapperSource, /emitKyrubAiActionProposal/);

  assert.match(executionSource, /PRODUCT_OWNERSHIP_REQUIRED/);
  assert.match(executionSource, /PRODUCT_CHANGED/);
  assert.match(executionSource, /normalizeProductPatch/);
  assert.match(executionSource, /PRODUCT_PATCH_KEYS/);
  assert.doesNotMatch(executionSource, /PRODUCT_PATCH_KEYS[^\n]*stock/);
  assert.match(executionSource, /permissions:\s*\['products\.write'\]/);
  assert.match(executionSource, /authorizationMode:\s*'human_confirmation'/);
  assert.match(executionSource, /kyrub_action_receipts/);
  assert.match(executionSource, /stores\/\$\{canonicalStore\.id\}\/products/);
  assert.match(executionSource, /tenants\/\$\{actor\.uid\}/);

  assert.match(facadeSource, /isKyrubProductUpdateExecutionRequest/);
  assert.match(facadeSource, /executeLegacyAuthorizedKyrubAction/);
  assert.match(apiSource, /actionExecutionFacade/);
  assert.match(routerSource, /actionExecutionFacade/);

  assert.match(actionEventsSource, /case 'update_product'/);
  assert.match(actionEventsSource, /isProductPatch\(value\.patch\)/);
  assert.match(bridgeSource, /Alterações propostas/);
  assert.match(bridgeSource, /Estoque e status de publicação não fazem parte desta ação/);
  assert.match(
    bridgeSource,
    /executeKyrubAction\(user,\s*current\.proposal,\s*true\)/
  );
  assert.match(bridgeSource, /invalidateKyrubErpContext/);
  assert.match(appSource, /<KyrubAiProductUpdateActionBridge \/>/);
});
