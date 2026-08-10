import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import type { KyrubAiConversationMessage } from '../shared/aiConsultant';
import type { KyrubErpContextSnapshot } from '../shared/kyrubErpContext';
import { KYRUB_COMMERCIAL_PLANS_V1 } from '../shared/kyrubCommercialPlans';
import {
  describeKyrubiaPlanContextForGenerative,
  resolveKyrubiaPlanConversation,
} from '../src/ai/planConversationRuntime';

const erpContext = (productCount = 5): KyrubErpContextSnapshot => ({
  source: 'authenticated_client_snapshot',
  generatedAt: '2026-08-10T12:30:00.000Z',
  store: {
    id: 'owner-plan-test',
    name: 'Loja Teste',
    description: '',
    plan: 'free',
    status: 'closed',
    address: '',
    keywords: ['teste'],
    configured: true,
  },
  products: [],
  productCount,
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

const baseConversation = (): KyrubAiConversationMessage[] => [
  { role: 'user', content: 'Cadastre mais 2 produtos na minha loja.' },
  {
    role: 'assistant',
    content:
      'Sua loja já está usando os 5 produtos do Free. Para ampliar o catálogo, o próximo passo é o plano Pro. O Business não é necessário para essa necessidade.',
  },
];

test('plan runtime answers Pro capabilities from the official V1 reference without Gemini', () => {
  const messages = [
    ...baseConversation(),
    { role: 'user' as const, content: 'O que o plano Pro libera?' },
  ];
  const result = resolveKyrubiaPlanConversation(messages, erpContext());

  assert.equal(result?.focusPlan, 'pro');
  assert.match(result?.reply ?? '', /100 produtos ou serviços ativos/i);
  assert.match(result?.reply ?? '', /300 Créditos Kyrubia/i);
  assert.match(result?.reply ?? '', /R\$\s*79,90/i);
  assert.match(result?.reply ?? '', /Business não é necessário/i);
  assert.match(result?.reply ?? '', /contratação.*ainda não está conectada/i);
});

test('plan runtime keeps conversational focus across short surprise-style follow-ups', () => {
  const firstMessages = [
    ...baseConversation(),
    { role: 'user' as const, content: 'O que o plano Pro libera?' },
  ];
  const first = resolveKyrubiaPlanConversation(firstMessages, erpContext());
  assert.ok(first);

  const priceMessages = [
    ...firstMessages,
    { role: 'assistant' as const, content: first.reply },
    { role: 'user' as const, content: 'E quanto custa?' },
  ];
  const price = resolveKyrubiaPlanConversation(priceMessages, erpContext());
  assert.equal(price?.focusPlan, 'pro');
  assert.match(price?.reply ?? '', /R\$\s*79,90/i);

  const businessMessages = [
    ...priceMessages,
    { role: 'assistant' as const, content: price?.reply ?? '' },
    { role: 'user' as const, content: 'E o Business?' },
  ];
  const business = resolveKyrubiaPlanConversation(
    businessMessages,
    erpContext()
  );
  assert.equal(business?.focusPlan, 'business');
  assert.match(business?.reply ?? '', /R\$\s*199,90/i);
  assert.match(business?.reply ?? '', /1\.500 Créditos Kyrubia/i);

  const creditsMessages = [
    ...businessMessages,
    { role: 'assistant' as const, content: business?.reply ?? '' },
    { role: 'user' as const, content: 'E os créditos?' },
  ];
  const credits = resolveKyrubiaPlanConversation(creditsMessages, erpContext());
  assert.equal(credits?.focusPlan, 'business');
  assert.match(credits?.reply ?? '', /1\.500 Créditos Kyrubia/i);
});

test('plan runtime refuses to fake a paid upgrade flow that is not implemented', () => {
  const messages = [
    ...baseConversation(),
    { role: 'user' as const, content: 'Posso assinar o Pro agora?' },
  ];
  const result = resolveKyrubiaPlanConversation(messages, erpContext());

  assert.equal(result?.focusPlan, 'pro');
  assert.match(result?.reply ?? '', /ainda não está conectada/i);
  assert.match(result?.reply ?? '', /não vou fingir/i);
});

test('plan runtime can recommend the smallest sufficient catalog tier deterministically', () => {
  const pro = resolveKyrubiaPlanConversation(
    [
      ...baseConversation(),
      { role: 'user', content: 'E se eu quiser ter 80 produtos?' },
    ],
    erpContext()
  );
  assert.match(pro?.reply ?? '', /Pro é o menor plano previsto suficiente/i);
  assert.match(pro?.reply ?? '', /Business seria desnecessário/i);

  const business = resolveKyrubiaPlanConversation(
    [
      ...baseConversation(),
      { role: 'user', content: 'E se eu quiser ter 150 produtos?' },
    ],
    erpContext()
  );
  assert.match(business?.reply ?? '', /Pro.*100.*não seria suficiente/i);
  assert.match(business?.reply ?? '', /Business/i);
});

test('open commercial judgment remains generative but receives a compact grounded plan context', () => {
  const messages = [
    ...baseConversation(),
    {
      role: 'user' as const,
      content: 'O que você acha desse preço do Pro para competir no mercado?',
    },
  ];
  const deterministic = resolveKyrubiaPlanConversation(messages, erpContext());
  const context = describeKyrubiaPlanContextForGenerative(messages);

  assert.equal(deterministic, null);
  assert.ok(context);
  assert.ok(context.length <= 240);
  assert.match(context, /Pro R\$79,90\/100 itens\/300 créditos/i);
  assert.match(context, /Checkout pago indisponível/i);
});

test('plan context never steals product mutations or live ERP count questions', () => {
  const mutation = [
    ...baseConversation(),
    { role: 'user' as const, content: 'Cadastre um produto chamado Caneca.' },
  ];
  assert.equal(resolveKyrubiaPlanConversation(mutation, erpContext()), null);
  assert.equal(describeKyrubiaPlanContextForGenerative(mutation), null);

  const liveRead = [
    ...baseConversation(),
    { role: 'user' as const, content: 'Quantos produtos eu tenho agora?' },
  ];
  assert.equal(resolveKyrubiaPlanConversation(liveRead, erpContext()), null);
  assert.equal(describeKyrubiaPlanContextForGenerative(liveRead), null);
});

test('commercial plan reference stays separate from executable entitlement state', () => {
  assert.equal(KYRUB_COMMERCIAL_PLANS_V1.free.activeCatalogLimit, 5);
  assert.equal(KYRUB_COMMERCIAL_PLANS_V1.pro.activeCatalogLimit, 100);
  assert.equal(KYRUB_COMMERCIAL_PLANS_V1.pro.kyrubiaIntelligenceCredits, 300);
  assert.equal(KYRUB_COMMERCIAL_PLANS_V1.business.activeCatalogLimit, null);
  assert.equal(KYRUB_COMMERCIAL_PLANS_V1.business.kyrubiaIntelligenceCredits, 1_500);
});

test('browser build routes the Kyrubia workspace through the plan-aware consultant wrapper', () => {
  const vite = readFileSync(new URL('../vite.config.ts', import.meta.url), 'utf8');
  const wrapper = readFileSync(
    new URL('../src/ai/consultantClientWithPlans.ts', import.meta.url),
    'utf8'
  );

  assert.ok(vite.includes('find: /^\\.\\.\\/ai\\/consultantClient$/'));
  assert.match(vite, /consultantClientWithPlans\.ts/);
  assert.match(wrapper, /resolveKyrubiaPlanConversation/);
  assert.match(wrapper, /kyrub-plan-runtime-v1/);
  assert.match(wrapper, /requestLegacyKyrubAiConsultant/);
});
