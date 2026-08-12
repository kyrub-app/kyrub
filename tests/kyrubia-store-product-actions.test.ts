import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import type { User } from 'firebase/auth';
import type { KyrubErpContextSnapshot } from '../shared/kyrubErpContext';
import type {
  KyrubAiCreateProductProposal,
  KyrubAiUpdateStoreProfileProposal,
} from '../shared/kyrubActions';
import {
  buildKyrubExecutionEnvelope,
  normalizeKyrubActionExecutionProposal,
} from '../server/actions/actionExecutionService';
import { evaluateKyrubActionPolicy } from '../server/actions/kyrubiaPolicyEngine';
import { resolveKyrubiaOperationalWorkflow } from '../src/ai/operationalWorkflowRuntime';

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
  uid: 'owner-activation-test',
  getIdToken: async () => 'unused-token',
} as unknown as User;

const erpContext = (
  configured: boolean,
  productCount = 0,
  plan: 'free' | 'pro' | 'business' = 'free'
): KyrubErpContextSnapshot => ({
  source: 'authenticated_client_snapshot',
  generatedAt: '2026-08-09T19:00:00.000Z',
  store: {
    id: fakeUser.uid,
    name: configured ? 'Loja Teste' : '',
    description: '',
    plan,
    status: 'closed',
    address: '',
    keywords: configured ? ['roupas'] : [],
    configured,
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

test('product creation with no configured store is intercepted locally and asks for store activation', async () => {
  await withMemoryStorage(async () => {
    const result = await resolveKyrubiaOperationalWorkflow({
      user: fakeUser,
      conversationId: 'conversation-activation-1',
      message: 'Cadastre um produto chamado Camiseta por R$ 49,90, categoria roupas, com estoque de 3 unidades.',
      erpContext: erpContext(false),
    });

    assert.equal(result?.provider, 'kyrub');
    assert.equal(result?.mode, 'deterministic');
    assert.equal(result?.actionProposal?.type, 'start_store_activation');
    assert.equal(result?.actionProposal?.requiresConfirmation, true);
    assert.match(result?.reply ?? '', /loja precisa estar ativada|loja ainda não está ativada/i);
    assert.match(result?.reply ?? '', /não será publicada no marketplace/i);
  });
});

test('free-plan preflight blocks partial two-product creation when only one slot remains and offers upgrade', async () => {
  await withMemoryStorage(async storage => {
    const result = await resolveKyrubiaOperationalWorkflow({
      user: fakeUser,
      conversationId: 'conversation-capacity-4-of-5',
      message: 'Cadastre mais 2 produtos na minha loja.',
      erpContext: erpContext(true, 4, 'free'),
    });

    assert.equal(result?.provider, 'kyrub');
    assert.equal(result?.mode, 'deterministic');
    assert.equal(result?.actionProposal, undefined);
    assert.match(result?.reply ?? '', /4 dos 5 produtos/i);
    assert.match(result?.reply ?? '', /espaço para apenas 1/i);
    assert.match(result?.reply ?? '', /plano Business/i);
    assert.match(result?.reply ?? '', /Nenhum produto foi criado ainda/i);
    assert.equal(storage.length, 0);
  });
});

test('free-plan preflight turns a full catalog request into an upgrade conversation before execution', async () => {
  await withMemoryStorage(async storage => {
    const result = await resolveKyrubiaOperationalWorkflow({
      user: fakeUser,
      conversationId: 'conversation-capacity-5-of-5',
      message: 'Cadastre um novo produto na minha loja.',
      erpContext: erpContext(true, 5, 'free'),
    });

    assert.equal(result?.actionProposal, undefined);
    assert.match(result?.reply ?? '', /5 produtos incluídos no plano atual/i);
    assert.match(result?.reply ?? '', /upgrade para o plano Business/i);
    assert.match(result?.reply ?? '', /Nenhum produto foi criado agora/i);
    assert.equal(storage.length, 0);
  });
});

test('a complete product request on a configured store becomes a create_product confirmation proposal locally', async () => {
  await withMemoryStorage(async () => {
    const result = await resolveKyrubiaOperationalWorkflow({
      user: fakeUser,
      conversationId: 'conversation-product-1',
      message: 'Cadastre um produto chamado Camiseta por R$ 49,90, categoria roupas, com estoque de 3 unidades.',
      erpContext: erpContext(true),
    });

    assert.equal(result?.provider, 'kyrub');
    assert.equal(
      result?.actionProposal?.type,
      'create_product',
      JSON.stringify({ reply: result?.reply, actionProposal: result?.actionProposal })
    );
    if (result?.actionProposal?.type !== 'create_product') {
      assert.fail('Expected create_product proposal.');
    }
    assert.equal(result.actionProposal.name, 'Camiseta');
    assert.equal(result.actionProposal.price, 49.9);
    assert.equal(result.actionProposal.category, 'roupas');
    assert.equal(result.actionProposal.stock, 3);
    assert.equal(result.actionProposal.requiresConfirmation, true);
  });
});

test('promotional Pro at five products is eligible to prepare the sixth product instead of hitting the Free gate', async () => {
  await withMemoryStorage(async () => {
    const result = await resolveKyrubiaOperationalWorkflow({
      user: fakeUser,
      conversationId: 'conversation-pro-sixth-product',
      message: 'Cadastre um produto chamado Caneca Pro por R$ 30, categoria presentes, com estoque de 5 unidades.',
      erpContext: erpContext(true, 5, 'pro'),
    });

    assert.equal(result?.actionProposal?.type, 'create_product');
    assert.doesNotMatch(result?.reply ?? '', /plano chegou ao limite|upgrade para o plano Pro/i);
  });
});

test('business plan is not blocked by the free-plan capacity preflight', async () => {
  await withMemoryStorage(async () => {
    const result = await resolveKyrubiaOperationalWorkflow({
      user: fakeUser,
      conversationId: 'conversation-business-product',
      message: 'Cadastre um produto chamado Caneca por R$ 30, categoria presentes, com estoque de 5 unidades.',
      erpContext: erpContext(true, 12, 'business'),
    });

    assert.equal(result?.actionProposal?.type, 'create_product');
  });
});

test('product writes require a fresh final confirmation', () => {
  const proposal: KyrubAiCreateProductProposal = {
    id: 'product-proposal-1',
    type: 'create_product',
    name: 'Camiseta',
    description: '',
    price: 49.9,
    stock: 3,
    category: 'roupas',
    image: '',
    isService: false,
    isComplimentary: false,
    requiresConfirmation: true,
    inputProvenance: 'user_intent',
    impact: { entityCount: 1, reversibility: 'limited' },
  };

  const before = evaluateKyrubActionPolicy(proposal, {
    actorUid: fakeUser.uid,
    permissions: ['products.write'],
    confirmed: false,
    decisionId: 'product-before',
  });
  const after = evaluateKyrubActionPolicy(proposal, {
    actorUid: fakeUser.uid,
    permissions: ['products.write'],
    confirmed: true,
    decisionId: 'product-after',
  });

  assert.equal(before.outcome, 'require_confirmation');
  assert.ok(before.reasons.includes('CONFIRMATION_REQUIRED'));
  assert.equal(after.outcome, 'allow');
});

test('store profile patches are only policy-eligible as the preauthorized scoped action', () => {
  const proposal: KyrubAiUpdateStoreProfileProposal = {
    id: 'store-patch-1',
    type: 'update_store_profile',
    activationGrantId: 'grant-1',
    patch: { name: 'Minha Loja' },
    requiresConfirmation: false,
    inputProvenance: 'user_intent',
    impact: { entityCount: 1, reversibility: 'easy' },
  };

  const denied = evaluateKyrubActionPolicy(proposal, {
    actorUid: fakeUser.uid,
    permissions: [],
    confirmed: false,
    decisionId: 'store-denied',
  });
  const eligible = evaluateKyrubActionPolicy(proposal, {
    actorUid: fakeUser.uid,
    permissions: ['store.profile.write'],
    confirmed: false,
    decisionId: 'store-preauthorized',
  });

  assert.equal(denied.outcome, 'deny');
  assert.ok(denied.reasons.includes('PERMISSION_REQUIRED'));
  assert.equal(eligible.outcome, 'allow');
});

test('server owns product blast radius and ignores a client-supplied impact escalation', () => {
  const normalized = normalizeKyrubActionExecutionProposal({
    id: 'product-proposal-2',
    type: 'create_product',
    name: 'Caneca',
    description: '',
    price: 30,
    stock: 5,
    category: 'presentes',
    image: '',
    isService: false,
    isComplimentary: false,
    requiresConfirmation: true,
    inputProvenance: 'user_intent',
    impact: { entityCount: 999, reversibility: 'hard' },
  });

  assert.equal(normalized.type, 'create_product');
  assert.deepEqual(normalized.impact, {
    entityCount: 1,
    reversibility: 'limited',
  });
});

test('store profile execution can carry an explicit preauthorized envelope only after grant validation', () => {
  const proposal: KyrubAiUpdateStoreProfileProposal = {
    id: 'store-patch-2',
    type: 'update_store_profile',
    activationGrantId: 'grant-2',
    patch: { keywords: ['roupas'] },
    requiresConfirmation: false,
    inputProvenance: 'user_intent',
    impact: { entityCount: 1, reversibility: 'easy' },
  };
  const decision = evaluateKyrubActionPolicy(proposal, {
    actorUid: fakeUser.uid,
    permissions: ['store.profile.write'],
    confirmed: false,
    decisionId: 'store-grant-decision',
  });
  const envelope = buildKyrubExecutionEnvelope(
    proposal,
    fakeUser.uid,
    'store-patch-idem',
    decision,
    new Date('2026-08-09T19:00:00.000Z'),
    'preauthorized'
  );

  assert.equal(decision.outcome, 'allow');
  assert.equal(envelope.authorizationMode, 'preauthorized');
  assert.equal(envelope.actorUid, fakeUser.uid);
});

test('source contracts keep activation scoped and use the authoritative commercial plan limits for product execution', () => {
  const source = readFileSync(
    new URL('../server/actions/actionExecutionService.ts', import.meta.url),
    'utf8'
  );

  assert.match(source, /scope: 'store_activation'/);
  assert.match(source, /allowedActions: \['update_store_profile'\]/);
  assert.match(source, /allowedFields: \[\.\.\.STORE_ACTIVATION_FIELDS\]/);
  assert.match(source, /STORE_ACTIVATION_GRANT_TTL_MS/);
  assert.match(source, /publicationStatus: 'paused'/);
  assert.match(source, /status: 'closed'/);
  assert.match(source, /normalizeExecutableStorePlan/);
  assert.match(source, /KYRUB_COMMERCIAL_PLANS_V1\[plan\]\.activeCatalogLimit/);
  assert.match(source, /PLAN_PRODUCT_LIMIT_REACHED/);
  assert.match(source, /STORE_ACTIVATION_REQUIRED/);
  assert.doesNotMatch(source, /FREE_PLAN_PRODUCT_LIMIT/);

  const canonicalStoreCreation = /const id = deterministicCanonicalStoreId\(uid\);([\s\S]*?)return \{ id, name \};/.exec(source)?.[1] ?? '';
  assert.match(canonicalStoreCreation, /publicationStatus: 'paused'/);
  assert.match(canonicalStoreCreation, /migrationStatus: 'registry_only'/);
  assert.doesNotMatch(canonicalStoreCreation, /publicationStatus: 'published'/);
  assert.doesNotMatch(canonicalStoreCreation, /status: 'open'/);
});

test('quota-first contract keeps operational workflow ahead of the generative network call', () => {
  const client = readFileSync(
    new URL('../src/ai/consultantClient.ts', import.meta.url),
    'utf8'
  );
  const runtime = readFileSync(
    new URL('../src/ai/operationalWorkflowRuntime.ts', import.meta.url),
    'utf8'
  );

  const workflowIndex = client.indexOf('resolveKyrubiaOperationalWorkflow({');
  const deterministicIndex = client.indexOf('resolveKyrubiaDeterministicErpRead(');
  const networkIndex = client.indexOf('fetch(endpoint');
  assert.ok(workflowIndex > 0);
  assert.ok(deterministicIndex > workflowIndex);
  assert.ok(networkIndex > deterministicIndex);
  assert.match(runtime, /productCapacityPreflight/);
  assert.match(runtime, /FREE_PLAN_PRODUCT_LIMIT = 5/);
  assert.doesNotMatch(runtime, /GEMINI_API_KEY|generativelanguage\.googleapis\.com/);
});

test('browser action client crosses only the official safe executor and never writes Firestore directly', () => {
  const source = readFileSync(
    new URL('../src/actions/kyrubActionService.ts', import.meta.url),
    'utf8'
  );

  assert.match(source, /\/api\/action-execute/);
  assert.match(source, /getIdToken\(true\)/);
  assert.match(source, /invalidateKyrubErpContext\(user\.uid\)/);
  assert.doesNotMatch(source, /firebase\/firestore/);
  assert.doesNotMatch(source, /setDoc\s*\(|updateDoc\s*\(|runTransaction\s*\(/);
});
