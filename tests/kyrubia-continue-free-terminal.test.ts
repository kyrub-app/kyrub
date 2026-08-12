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

test('choosing Continue on Free consumes the offer instead of re-offering the same decision', () => {
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
  assert.equal(result.turnContext.offeredIntents?.length ?? 0, 0);
});

test('typing the exact Continue on Free label also closes that offered-intent branch', () => {
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
  assert.equal(result.turnContext.offeredIntents?.length ?? 0, 0);
});