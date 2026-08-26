import assert from 'node:assert/strict';
import test from 'node:test';
import type { KyrubErpContextSnapshot } from '../shared/kyrubErpContext.js';
import { resolveKyrubiaDeterministicStorePromotion } from '../src/ai/deterministicStorePromotion.js';

const context: KyrubErpContextSnapshot = {
  source: 'authenticated_client_snapshot',
  generatedAt: '2026-08-26T05:00:00.000Z',
  store: {
    id: 'owner-1',
    name: 'Loja Teste',
    description: '',
    plan: 'free',
    status: 'open',
    address: '',
    keywords: [],
    configured: true,
  },
  products: [
    {
      id: 'xburger',
      name: 'X-Burger',
      category: 'Burgers',
      price: 29.5,
      stock: 10,
      isService: false,
      hasDescription: true,
      hasImage: true,
    },
    {
      id: 'dessert',
      name: 'Taça Simples',
      category: 'Sobremesas',
      price: 12,
      stock: 5,
      isService: false,
      hasDescription: true,
      hasImage: true,
    },
  ],
  productCount: 2,
  productsTruncated: false,
  pendingOrders: [],
  pendingOrderCount: 0,
  ordersTruncated: false,
  lowStockThreshold: 3,
  availability: {
    store: true,
    products: true,
    orders: true,
  },
  warnings: [],
};

const now = new Date('2026-08-26T05:00:00.000Z');

test('turns a natural 95% X-Burger request into a governed promotion proposal', () => {
  const result = resolveKyrubiaDeterministicStorePromotion(
    'Kyrubia, libera um cupom de desconto de 95% para o X-Burger.',
    context,
    now
  );

  assert.ok(result);
  assert.equal(result.proposal.type, 'create_store_promotion');
  assert.equal(result.proposal.storeId, 'owner-1');
  assert.deepEqual(result.proposal.productIds, ['xburger']);
  assert.equal(result.proposal.discountType, 'percentage');
  assert.equal(result.proposal.discountValue, 95);
  assert.equal(result.proposal.badge, '95% OFF');
  assert.equal(result.proposal.requiresConfirmation, true);
  assert.equal(result.proposal.maxRedemptionsPerBuyer, 1);
});

test('understands cheeseburger as an alias for X-Burger in this catalog', () => {
  const result = resolveKyrubiaDeterministicStorePromotion(
    'Crie uma promoção de 95% para o cheeseburger por 24 horas.',
    context,
    now
  );

  assert.ok(result);
  assert.deepEqual(result.proposal.productIds, ['xburger']);
  assert.equal(result.proposal.endsAt, '2026-08-27T05:00:00.000Z');
});

test('reads a global redemption limit without changing the per-buyer default', () => {
  const result = resolveKyrubiaDeterministicStorePromotion(
    'Libere 30% de desconto no X-Burger para os primeiros 10 clientes.',
    context,
    now
  );

  assert.ok(result);
  assert.equal(result.proposal.maxRedemptions, 10);
  assert.equal(result.proposal.maxRedemptionsPerBuyer, 1);
});

test('does not create a proposal when the product cannot be resolved authoritatively', () => {
  const result = resolveKyrubiaDeterministicStorePromotion(
    'Crie um cupom de 50% para a pizza grande.',
    context,
    now
  );

  assert.equal(result, null);
});

test('keeps 100% discount out of the Pix promotion path', () => {
  const result = resolveKyrubiaDeterministicStorePromotion(
    'Libere 100% de desconto no X-Burger.',
    context,
    now
  );

  assert.equal(result, null);
});
