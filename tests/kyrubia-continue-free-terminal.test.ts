import assert from 'node:assert/strict';
import test from 'node:test';
import type { KyrubAiConversationMessage } from '../shared/aiConsultant';
import type { KyrubErpContextSnapshot } from '../shared/kyrubErpContext';
import {
  createKyrubiaCapacityPlanTurnContext,
  resolveKyrubiaOfferedIntentContinuation,
} from '../src/ai/offeredIntentRuntime';

const erpContext = (): KyrubErpContextSnapshot => ({
  source: 'authenticated_client_snapshot',
  generatedAt: '2026-08-12T13:45:00.000Z',
  store: {
    id: 'owner-free-terminal-test',
    name: 'Loja Teste',
    description: '',
    plan: 'free',
    status: 'closed',
    address: '',
    keywords: ['teste'],
    configured: true,
  },
  products: [],
  productCount: 5,
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

const intents = (result: ReturnType<typeof createKyrubiaCapacityPlanTurnContext>) =>
  result.offeredIntents?.map(item => item.intent) ?? [];

test('choosing Continue on Free consumes only that chip and preserves sibling suggestions', () => {
  const turnContext = createKyrubiaCapacityPlanTurnContext(
    'owner-free-terminal-test'
  );
  const stayFree = turnContext.offeredIntents?.find(
    item => item.intent === 'plan.continue_free'
  );
  assert.ok(stayFree);

  const messages: KyrubAiConversationMessage[] = [
    {
      role: 'user',
      content: 'O q podemos fazer agora pra cadastrar produtos na minha loja Kyrub?',
    },
    {
      role: 'assistant',
      content:
        'Sua loja já está usando os 5 produtos incluídos no plano atual (Free). Nenhum produto foi criado agora.',
    },
    { role: 'user', content: 'Continuar no Free' },
  ];

  const result = resolveKyrubiaOfferedIntentContinuation(
    messages,
    turnContext,
    stayFree.id,
    erpContext()
  );

  assert.ok(result);
  assert.match(result.reply, /Você pode continuar no Free/i);
  assert.deepEqual(intents(result.turnContext), ['plan.explain', 'plan.compare']);
});

test('typing the exact Continue on Free label consumes only the matching chip', () => {
  const turnContext = createKyrubiaCapacityPlanTurnContext(
    'owner-free-terminal-test'
  );
  const result = resolveKyrubiaOfferedIntentContinuation(
    [{ role: 'user', content: 'Continuar no Free' }],
    turnContext,
    undefined,
    erpContext()
  );

  assert.ok(result);
  assert.match(result.reply, /Você pode continuar no Free/i);
  assert.deepEqual(intents(result.turnContext), ['plan.explain', 'plan.compare']);
});

test('every selected chip is consumed independently while the remaining chips stay available', () => {
  const initialTurn = createKyrubiaCapacityPlanTurnContext(
    'owner-free-terminal-test'
  );
  const compare = initialTurn.offeredIntents?.find(
    item => item.intent === 'plan.compare'
  );
  assert.ok(compare);

  const compared = resolveKyrubiaOfferedIntentContinuation(
    [{ role: 'user', content: 'Comparar planos' }],
    initialTurn,
    compare.id,
    erpContext()
  );
  assert.ok(compared);
  assert.match(compared.reply, /Free/i);
  assert.match(compared.reply, /Pro/i);
  assert.match(compared.reply, /Business/i);
  assert.deepEqual(intents(compared.turnContext), [
    'plan.explain',
    'plan.continue_free',
  ]);

  const stayFree = compared.turnContext.offeredIntents?.find(
    item => item.intent === 'plan.continue_free'
  );
  assert.ok(stayFree);
  const stayed = resolveKyrubiaOfferedIntentContinuation(
    [{ role: 'user', content: 'Continuar no Free' }],
    compared.turnContext,
    stayFree.id,
    erpContext()
  );
  assert.ok(stayed);
  assert.deepEqual(intents(stayed.turnContext), ['plan.explain']);
});
