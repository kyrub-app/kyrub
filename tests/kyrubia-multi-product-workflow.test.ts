import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import type { User } from 'firebase/auth';
import type { KyrubErpContextSnapshot } from '../shared/kyrubErpContext';
import { resolveKyrubiaOperationalWorkflow } from '../src/ai/operationalWorkflowRuntime';
import {
  clearKyrubiaOperationalWorkflow,
  completeKyrubiaProductAndAdvance,
  getKyrubiaProductSequenceProgress,
  loadKyrubiaOperationalWorkflow,
} from '../src/ai/operationalWorkflowStore';

class MemoryStorage implements Storage {
  private readonly values = new Map<string, string>();

  get length(): number {
    return this.values.size;
  }

  clear(): void {
    this.values.clear();
  }

  getItem(key: string): string | null {
    return this.values.get(key) ?? null;
  }

  key(index: number): string | null {
    return Array.from(this.values.keys())[index] ?? null;
  }

  removeItem(key: string): void {
    this.values.delete(key);
  }

  setItem(key: string, value: string): void {
    this.values.set(key, value);
  }
}

const fakeUser = {
  uid: 'owner-multi-product-test',
  email: 'owner@example.com',
  getIdToken: async () => 'unused-token',
} as unknown as User;

const erpContext = (
  productCount: number,
  plan: 'free' | 'business' = 'free'
): KyrubErpContextSnapshot => ({
  source: 'authenticated_client_snapshot',
  generatedAt: '2026-08-10T10:00:00.000Z',
  store: {
    id: fakeUser.uid,
    name: 'Loja Teste',
    description: '',
    plan,
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

const withMemoryStorage = async <T>(run: (storage: MemoryStorage) => Promise<T>) => {
  const previous = Object.getOwnPropertyDescriptor(globalThis, 'localStorage');
  const storage = new MemoryStorage();
  Object.defineProperty(globalThis, 'localStorage', {
    configurable: true,
    value: storage,
  });
  try {
    return await run(storage);
  } finally {
    if (previous) Object.defineProperty(globalThis, 'localStorage', previous);
    else delete (globalThis as { localStorage?: Storage }).localStorage;
  }
};

test('multi-product intent persists a sequential workflow instead of collapsing two items into one draft', async () => {
  await withMemoryStorage(async storage => {
    const conversationId = 'conversation-multi-product-sequence';
    const start = await resolveKyrubiaOperationalWorkflow({
      user: fakeUser,
      conversationId,
      message: 'Cadastre mais 2 produtos na minha loja.',
      erpContext: erpContext(2),
    });

    assert.equal(start?.actionProposal, undefined);
    assert.match(start?.reply ?? '', /2 produtos/i);
    assert.match(start?.reply ?? '', /produto 1 de 2/i);

    const initialWorkflow = loadKyrubiaOperationalWorkflow(
      storage,
      fakeUser.uid,
      conversationId
    );
    assert.ok(initialWorkflow);
    assert.deepEqual(getKyrubiaProductSequenceProgress(initialWorkflow), {
      requestedCount: 2,
      completedCount: 0,
      hasMore: true,
      nextItemNumber: 1,
    });

    const combinedNames = await resolveKyrubiaOperationalWorkflow({
      user: fakeUser,
      conversationId,
      message: 'Teste2 e teste 3',
      erpContext: erpContext(2),
    });
    assert.equal(combinedNames?.actionProposal, undefined);
    assert.match(combinedNames?.reply ?? '', /um por vez/i);
    assert.match(combinedNames?.reply ?? '', /produto 1 de 2/i);

    const afterCombinedNames = loadKyrubiaOperationalWorkflow(
      storage,
      fakeUser.uid,
      conversationId
    );
    assert.equal(afterCombinedNames?.productDraft.name, undefined);

    const name = await resolveKyrubiaOperationalWorkflow({
      user: fakeUser,
      conversationId,
      message: 'Teste2',
      erpContext: erpContext(2),
    });
    assert.match(name?.reply ?? '', /preço de “Teste2”/i);

    const combinedPrices = await resolveKyrubiaOperationalWorkflow({
      user: fakeUser,
      conversationId,
      message: 'R$14 e R$21',
      erpContext: erpContext(2),
    });
    assert.equal(combinedPrices?.actionProposal, undefined);
    assert.match(combinedPrices?.reply ?? '', /somente o preço/i);

    await resolveKyrubiaOperationalWorkflow({
      user: fakeUser,
      conversationId,
      message: 'R$14',
      erpContext: erpContext(2),
    });
    await resolveKyrubiaOperationalWorkflow({
      user: fakeUser,
      conversationId,
      message: 'Testando',
      erpContext: erpContext(2),
    });
    const firstReview = await resolveKyrubiaOperationalWorkflow({
      user: fakeUser,
      conversationId,
      message: '10',
      erpContext: erpContext(2),
    });

    assert.equal(firstReview?.actionProposal?.type, 'create_product');
    assert.match(firstReview?.reply ?? '', /Produto 1 de 2/i);
    if (firstReview?.actionProposal?.type !== 'create_product') {
      assert.fail('Expected create_product proposal for the first product.');
    }
    assert.equal(firstReview.actionProposal.name, 'Teste2');
    assert.equal(firstReview.actionProposal.price, 14);
    assert.equal(firstReview.actionProposal.stock, 10);

    const progress = completeKyrubiaProductAndAdvance(
      storage,
      fakeUser.uid,
      conversationId
    );
    assert.deepEqual(progress, {
      requestedCount: 2,
      completedCount: 1,
      hasMore: true,
      nextItemNumber: 2,
    });

    // The legacy confirmation bridge still calls clear after a successful product.
    // The workflow store consumes the one-shot preservation marker instead.
    clearKyrubiaOperationalWorkflow(storage, fakeUser.uid, conversationId);
    const preserved = loadKyrubiaOperationalWorkflow(
      storage,
      fakeUser.uid,
      conversationId
    );
    assert.equal(preserved?.stage, 'collecting_product_name');
    assert.equal(preserved?.completedProductCount, 1);

    const secondName = await resolveKyrubiaOperationalWorkflow({
      user: fakeUser,
      conversationId,
      message: 'Teste 3',
      erpContext: erpContext(3),
    });
    assert.match(secondName?.reply ?? '', /preço de “Teste 3”/i);

    const secondWorkflow = loadKyrubiaOperationalWorkflow(
      storage,
      fakeUser.uid,
      conversationId
    );
    assert.equal(secondWorkflow?.productDraft.name, 'Teste 3');
    assert.equal(secondWorkflow?.completedProductCount, 1);
  });
});

test('free-plan capacity is rechecked before the next item and stops a sequence if the catalog fills meanwhile', async () => {
  await withMemoryStorage(async storage => {
    const conversationId = 'conversation-multi-product-race';
    await resolveKyrubiaOperationalWorkflow({
      user: fakeUser,
      conversationId,
      message: 'Cadastre 2 produtos na minha loja.',
      erpContext: erpContext(3),
    });
    await resolveKyrubiaOperationalWorkflow({
      user: fakeUser,
      conversationId,
      message: 'Primeiro',
      erpContext: erpContext(3),
    });
    await resolveKyrubiaOperationalWorkflow({
      user: fakeUser,
      conversationId,
      message: 'R$ 10',
      erpContext: erpContext(3),
    });
    await resolveKyrubiaOperationalWorkflow({
      user: fakeUser,
      conversationId,
      message: 'Teste',
      erpContext: erpContext(3),
    });
    const review = await resolveKyrubiaOperationalWorkflow({
      user: fakeUser,
      conversationId,
      message: '1',
      erpContext: erpContext(3),
    });
    assert.equal(review?.actionProposal?.type, 'create_product');

    const progress = completeKyrubiaProductAndAdvance(
      storage,
      fakeUser.uid,
      conversationId
    );
    assert.equal(progress?.completedCount, 1);
    assert.equal(progress?.hasMore, true);

    const blocked = await resolveKyrubiaOperationalWorkflow({
      user: fakeUser,
      conversationId,
      message: 'Segundo',
      erpContext: erpContext(5),
    });

    assert.equal(blocked?.actionProposal, undefined);
    assert.match(blocked?.reply ?? '', /plano Pro/i);
    assert.match(blocked?.reply ?? '', /interrompi a sequência/i);
    assert.match(blocked?.reply ?? '', /Business não é necessário/i);
    assert.equal(storage.length, 0);
  });
});

test('free-plan closer offers Pro at the five-product limit and explicitly avoids overselling Business', async () => {
  await withMemoryStorage(async storage => {
    const result = await resolveKyrubiaOperationalWorkflow({
      user: fakeUser,
      conversationId: 'conversation-free-to-pro',
      message: 'Cadastre um novo produto na minha loja.',
      erpContext: erpContext(5),
    });

    assert.equal(result?.actionProposal, undefined);
    assert.match(result?.reply ?? '', /upgrade para o plano Pro/i);
    assert.match(result?.reply ?? '', /Business não é necessário/i);
    assert.match(result?.reply ?? '', /não recomendo upgrade para o plano Business/i);
    assert.equal(storage.length, 0);
  });
});

test('safe executor advances the local sequence and the action bridge surfaces the next product prompt', () => {
  const actionSource = readFileSync(
    new URL('../src/actions/kyrubActionService.ts', import.meta.url),
    'utf8'
  );
  const bridgeSource = readFileSync(
    new URL('../src/components/KyrubAiNoteActionBridge.tsx', import.meta.url),
    'utf8'
  );

  assert.match(actionSource, /completeKyrubiaProductAndAdvance/);
  assert.match(actionSource, /dispatchKyrubiaOperationalWorkflowMessage/);
  assert.match(actionSource, /invalidateKyrubErpContext\(user\.uid\)/);
  assert.match(bridgeSource, /KYRUBIA_OPERATIONAL_WORKFLOW_MESSAGE_EVENT/);
  assert.match(bridgeSource, /Kyrubia · próximo produto/);
});
