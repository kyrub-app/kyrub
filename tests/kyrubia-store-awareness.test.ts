import assert from 'node:assert/strict';
import test from 'node:test';
import type { KyrubErpContextSnapshot } from '../shared/kyrubErpContext';
import { resolveKyrubiaDeterministicErpRead } from '../shared/kyrubiaDeterministicErp';

const snapshot = (address = 'Rua das Flores, 123 - Centro'): KyrubErpContextSnapshot => ({
  source: 'authenticated_client_snapshot',
  generatedAt: new Date(0).toISOString(),
  store: {
    id: 'store-1',
    name: 'Loja Teste',
    description: 'Uma loja de teste.',
    plan: 'free',
    status: 'open',
    address,
    keywords: ['teste', 'varejo'],
    configured: true,
  },
  products: [],
  productCount: 0,
  productsTruncated: false,
  inventory: [],
  inventoryCount: 0,
  inventoryTruncated: false,
  inventoryMovements: [],
  inventoryMovementCount: 0,
  inventoryMovementsTruncated: false,
  pendingOrders: [],
  pendingOrderCount: 0,
  ordersTruncated: false,
  lowStockThreshold: 5,
  availability: {
    store: true,
    products: true,
    inventory: true,
    inventoryMovements: true,
    orders: true,
  },
  warnings: [],
});

test('reads the current store address from the authoritative ERP snapshot', () => {
  const result = resolveKyrubiaDeterministicErpRead(
    'Qual é o endereço cadastrado atualmente na minha loja?',
    snapshot()
  );
  assert.equal(result?.action, 'read_store_summary');
  assert.match(result?.reply ?? '', /Rua das Flores, 123 - Centro/);
});

test('recognizes pickup-location language as the same store address capability', () => {
  const result = resolveKyrubiaDeterministicErpRead(
    'Onde o entregador deve ir para fazer a coleta do pedido?',
    snapshot()
  );
  assert.match(result?.reply ?? '', /Rua das Flores, 123 - Centro/);
});

test('does not invent an address when the store has none', () => {
  const result = resolveKyrubiaDeterministicErpRead(
    'Onde fica minha loja?',
    snapshot('')
  );
  assert.match(result?.reply ?? '', /ainda não possui endereço cadastrado/i);
  assert.match(result?.reply ?? '', /preparo a atualização/i);
});

test('reads name, status, description and profile without Gemini', () => {
  assert.match(
    resolveKyrubiaDeterministicErpRead('Qual é o nome da minha loja?', snapshot())?.reply ?? '',
    /Loja Teste/
  );
  assert.match(
    resolveKyrubiaDeterministicErpRead('Minha loja está aberta?', snapshot())?.reply ?? '',
    /aberta/
  );
  assert.match(
    resolveKyrubiaDeterministicErpRead('Qual a descrição cadastrada da minha loja?', snapshot())?.reply ?? '',
    /Uma loja de teste/
  );
  const profile = resolveKyrubiaDeterministicErpRead('Quais são os dados da minha loja?', snapshot());
  assert.match(profile?.reply ?? '', /Endereço:/);
  assert.match(profile?.reply ?? '', /Plano: free/);
});

test('store awareness never intercepts mutation commands', () => {
  const result = resolveKyrubiaDeterministicErpRead(
    'Atualize o endereço da minha loja para Rua Nova, 500',
    snapshot()
  );
  assert.equal(result, null);
});

test('does not claim a store exists when none is activated', () => {
  const noStore = { ...snapshot(), store: null };
  const result = resolveKyrubiaDeterministicErpRead('Qual é o endereço da minha loja?', noStore);
  assert.match(result?.reply ?? '', /não encontrei uma loja ativada/i);
});
