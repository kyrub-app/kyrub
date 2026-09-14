import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import type { User } from 'firebase/auth';
import type { KyrubErpContextSnapshot } from '../shared/kyrubErpContext';
import { resolveKyrubiaObjectiveRuntime } from '../src/ai/objectiveRuntimeService';
import { resolveKyrubiaOperationalWorkflow } from '../src/ai/operationalWorkflowRuntime';
import {
  completeKyrubiaProductAndAdvance,
  loadKyrubiaOperationalWorkflow,
  saveKyrubiaOperationalWorkflow,
} from '../src/ai/operationalWorkflowStore';
import {
  clearOfficialKnowledgeRuntimeSnapshot,
  setOfficialKnowledgeRuntimeSnapshot,
} from '../src/knowledge/officialKnowledgeRuntimeCache';

class MemoryStorage implements Storage {
  private readonly values = new Map<string, string>();

  get length(): number { return this.values.size; }
  clear(): void { this.values.clear(); }
  getItem(key: string): string | null { return this.values.get(key) ?? null; }
  key(index: number): string | null { return [...this.values.keys()][index] ?? null; }
  removeItem(key: string): void { this.values.delete(key); }
  setItem(key: string, value: string): void { this.values.set(key, value); }
}

const officialSnapshot = () => ({
  source: 'official_communities' as const,
  generatedAt: '2026-08-10T23:00:00.000Z',
  warnings: [],
  items: [
    {
      schemaVersion: 1 as const,
      id: 'official-community:manual:debate:pro',
      authority: 'official_product_reference' as const,
      sourceKind: 'official_community' as const,
      sourceEntityType: 'community_debate' as const,
      sourceEntityId: 'pro',
      communityId: 'manual',
      title: 'O que o plano Pro libera?',
      content: 'O plano Pro prevê até 100 produtos ou serviços ativos e 300 Créditos Kyrubia Inteligência por mês.',
      status: 'active' as const,
      version: '2026-08-10T23:00:00.000Z',
      updatedAt: '2026-08-10T23:00:00.000Z',
      tags: [],
    },
  ],
});

test('explicit product mutation falls through trusted reads and reaches the safe operational preflight', async () => {
  const storage = new MemoryStorage();
  const previousDescriptor = Object.getOwnPropertyDescriptor(globalThis, 'localStorage');
  Object.defineProperty(globalThis, 'localStorage', {
    configurable: true,
    value: storage,
  });

  try {
    setOfficialKnowledgeRuntimeSnapshot(officialSnapshot());
    const message = 'O q podemos fazer agora pra cadastrar produtos na minha loja Kyrub?';

    const intercepted = resolveKyrubiaObjectiveRuntime(
      storage,
      'user-1',
      'conversation-1',
      message
    );
    assert.equal(intercepted, null);

    const operational = await resolveKyrubiaOperationalWorkflow({
      user: { uid: 'user-1' } as User,
      conversationId: 'conversation-1',
      message,
      erpContext: {
        store: { configured: true, plan: 'free' },
        productCount: 5,
        availability: { products: true },
      } as KyrubErpContextSnapshot,
    });

    assert.ok(operational);
    assert.match(operational.reply, /já está usando os 5 produtos/i);
    assert.match(operational.reply, /plano Pro/i);
    assert.match(operational.reply, /Nenhum produto foi criado agora/i);
    assert.equal(operational.actionProposal, undefined);
  } finally {
    clearOfficialKnowledgeRuntimeSnapshot();
    if (previousDescriptor) {
      Object.defineProperty(globalThis, 'localStorage', previousDescriptor);
    } else {
      delete (globalThis as { localStorage?: Storage }).localStorage;
    }
  }
});

test('repeated review of the same logical product reuses one create-product proposal id', async () => {
  const storage = new MemoryStorage();
  const previousDescriptor = Object.getOwnPropertyDescriptor(globalThis, 'localStorage');
  Object.defineProperty(globalThis, 'localStorage', {
    configurable: true,
    value: storage,
  });

  try {
    saveKyrubiaOperationalWorkflow(storage, {
      version: 1,
      conversationId: 'stable-product-conversation',
      userId: 'user-1',
      objective: 'create_product',
      stage: 'awaiting_product_confirmation',
      productDraft: {
        name: 'Squeeze 480ml Dobrável Laranja com Mosquetão',
        price: 29.9,
        stock: 4,
        category: 'Garrafas',
        image: '',
        photoSkipped: true,
        isService: false,
        isComplimentary: false,
      },
      requestedProductCount: 1,
      completedProductCount: 0,
      productChannelOfferChecked: true,
      updatedAt: new Date().toISOString(),
    });

    const input = {
      user: { uid: 'user-1' } as User,
      conversationId: 'stable-product-conversation',
      message: 'revise novamente',
    };
    const first = await resolveKyrubiaOperationalWorkflow(input);
    const second = await resolveKyrubiaOperationalWorkflow(input);

    assert.equal(first?.actionProposal?.type, 'create_product');
    assert.equal(second?.actionProposal?.type, 'create_product');
    if (first?.actionProposal?.type !== 'create_product' || second?.actionProposal?.type !== 'create_product') {
      assert.fail('Expected create_product proposals.');
    }
    assert.equal(second.actionProposal.id, first.actionProposal.id);

    const persisted = loadKyrubiaOperationalWorkflow(
      storage,
      'user-1',
      'stable-product-conversation'
    );
    assert.equal(persisted?.productProposalId, first.actionProposal.id);
  } finally {
    if (previousDescriptor) {
      Object.defineProperty(globalThis, 'localStorage', previousDescriptor);
    } else {
      delete (globalThis as { localStorage?: Storage }).localStorage;
    }
  }
});

test('legacy workflow without proposal identity gets one stable id and the next batch item resets it', async () => {
  const storage = new MemoryStorage();
  const previousDescriptor = Object.getOwnPropertyDescriptor(globalThis, 'localStorage');
  Object.defineProperty(globalThis, 'localStorage', {
    configurable: true,
    value: storage,
  });

  try {
    const conversationId = 'batch-product-conversation';
    saveKyrubiaOperationalWorkflow(storage, {
      version: 1,
      conversationId,
      userId: 'user-1',
      objective: 'create_product',
      stage: 'awaiting_product_confirmation',
      productDraft: {
        name: 'Produto A',
        price: 10,
        stock: 1,
        category: 'Teste',
        image: '',
        photoSkipped: true,
        isService: false,
        isComplimentary: false,
      },
      requestedProductCount: 2,
      completedProductCount: 0,
      productChannelOfferChecked: true,
      updatedAt: new Date().toISOString(),
    });

    const first = await resolveKyrubiaOperationalWorkflow({
      user: { uid: 'user-1' } as User,
      conversationId,
      message: 'revise',
    });
    assert.equal(first?.actionProposal?.type, 'create_product');
    if (first?.actionProposal?.type !== 'create_product') {
      assert.fail('Expected the first create_product proposal.');
    }
    const firstId = first.actionProposal.id;

    const progress = completeKyrubiaProductAndAdvance(
      storage,
      'user-1',
      conversationId
    );
    assert.equal(progress?.completedCount, 1);
    assert.equal(progress?.hasMore, true);

    const advanced = loadKyrubiaOperationalWorkflow(storage, 'user-1', conversationId);
    assert.equal(advanced?.stage, 'collecting_product_name');
    assert.equal(advanced?.productProposalId, undefined);
    assert.ok(advanced);

    saveKyrubiaOperationalWorkflow(storage, {
      ...advanced,
      stage: 'awaiting_product_confirmation',
      productDraft: {
        name: 'Produto B',
        price: 20,
        stock: 2,
        category: 'Teste',
        image: '',
        photoSkipped: true,
        isService: false,
        isComplimentary: false,
      },
      productChannelOfferChecked: true,
      updatedAt: new Date().toISOString(),
    });

    const second = await resolveKyrubiaOperationalWorkflow({
      user: { uid: 'user-1' } as User,
      conversationId,
      message: 'revise',
    });
    assert.equal(second?.actionProposal?.type, 'create_product');
    if (second?.actionProposal?.type !== 'create_product') {
      assert.fail('Expected the second create_product proposal.');
    }
    assert.notEqual(second.actionProposal.id, firstId);
  } finally {
    if (previousDescriptor) {
      Object.defineProperty(globalThis, 'localStorage', previousDescriptor);
    } else {
      delete (globalThis as { localStorage?: Storage }).localStorage;
    }
  }
});

test('official factual questions remain trusted reads after product workflow integration', () => {
  const storage = new MemoryStorage();
  setOfficialKnowledgeRuntimeSnapshot(officialSnapshot());

  try {
    const result = resolveKyrubiaObjectiveRuntime(
      storage,
      'user-1',
      'conversation-1',
      'O que o plano Pro libera?'
    );

    assert.ok(result);
    assert.match(result.reply, /Segundo o Manual KYRUB/);
    assert.match(result.reply, /100 produtos ou serviços ativos/);
  } finally {
    clearOfficialKnowledgeRuntimeSnapshot();
  }
});

test('informational product phrasing does not get promoted into mutation intent', () => {
  const storage = new MemoryStorage();
  setOfficialKnowledgeRuntimeSnapshot(officialSnapshot());

  try {
    const result = resolveKyrubiaObjectiveRuntime(
      storage,
      'user-1',
      'conversation-1',
      'Como cadastrar produtos na minha loja Kyrub?'
    );

    assert.ok(result);
    assert.match(result.reply, /Manual KYRUB/i);
    assert.match(
      result.reply,
      /(correspondência lexical é baixa|não encontrei uma correspondência)/i
    );
    assert.doesNotMatch(result.reply, /Tudo pronto para cadastrar/i);
  } finally {
    clearOfficialKnowledgeRuntimeSnapshot();
  }
});

test('full consultant path gives trusted reads precedence over the plan wrapper without stealing mutations', () => {
  const source = readFileSync(
    new URL('../src/ai/consultantClientWithPlans.ts', import.meta.url),
    'utf8'
  );
  const trustedCall = source.indexOf('resolveKyrubiaTrustedReadRuntime(');
  const offeredCall = source.indexOf('resolveKyrubiaOfferedIntentContinuation(');
  const planCall = source.indexOf('describeKyrubiaPlanContextForGenerative(');

  assert.ok(trustedCall >= 0);
  assert.ok(offeredCall > trustedCall);
  assert.ok(planCall > trustedCall);
  assert.match(source, /shouldDeferTrustedReadToOperationalWorkflow/);
  assert.match(source, /if \(trustedRead\)/);
});
