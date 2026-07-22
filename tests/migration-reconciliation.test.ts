import assert from 'node:assert/strict';
import test from 'node:test';
import {
  reconcileCash,
  reconcileOrders,
  reconcilePayments,
  reconcileProducts,
} from '../src/utils/migrationReconciliation';
import type { CustomerOrder } from '../src/utils/customerOrders';
import type { LegacyTablePaymentRecord } from '../src/utils/operationalDualWrite';
import type { CanonicalCashMovement, CanonicalCashSession } from '../src/utils/canonicalCash';
import type { PublicProduct } from '../src/utils/publicProducts';

const order = (overrides: Partial<CustomerOrder> = {}): CustomerOrder => ({
  id: 'order-a',
  storeId: 'legacy-owner',
  buyerId: 'buyer-a',
  buyerName: 'Cliente A',
  buyerEmail: 'buyer@example.com',
  fulfillmentType: 'dine_in',
  deliveryAddress: '',
  tableCode: '12',
  customerNote: '',
  items: [{
    lineId: 'line-a',
    productId: 'product-a',
    name: 'Produto A',
    price: 20,
    quantity: 2,
    paidQuantity: 1,
    transferredQuantity: 0,
    note: '',
    image: '',
    isService: false,
  }],
  subtotal: 40,
  total: 40,
  status: 'accepted',
  paymentStatus: 'partial',
  source: 'customer',
  operatorId: '',
  operatorName: '',
  createdAt: '2026-07-22T10:00:00.000Z',
  updatedAt: '2026-07-22T10:05:00.000Z',
  ...overrides,
});

const payment = (
  overrides: Partial<LegacyTablePaymentRecord> = {}
): LegacyTablePaymentRecord => ({
  id: 'payment-a',
  legacyStoreId: 'legacy-owner',
  tableCode: '12',
  method: 'pix',
  amount: 20,
  quantity: 1,
  items: [{
    orderId: 'order-a',
    lineId: 'line-a',
    productId: 'product-a',
    name: 'Produto A',
    quantity: 1,
    unitPrice: 20,
    total: 20,
  }],
  operatorId: 'owner-a',
  operatorName: 'Proprietário',
  createdAt: '2026-07-22T10:10:00.000Z',
  ...overrides,
});

const product = (overrides: Partial<PublicProduct> = {}): PublicProduct => ({
  id: 'product-a',
  storeId: 'legacy-owner',
  supplierId: 'legacy-owner',
  name: 'Produto A',
  description: 'Descrição',
  price: 20,
  image: '',
  stock: 3,
  category: 'Geral',
  isService: false,
  updatedAt: '2026-07-22T10:00:00.000Z',
  ...overrides,
});

const cashSession = (
  overrides: Partial<CanonicalCashSession> = {}
): CanonicalCashSession => ({
  id: 'cash-session-a',
  storeId: 'store-a',
  status: 'closed',
  operatorUserId: 'owner-a',
  operatorRole: 'owner',
  operatorName: 'Proprietário',
  openingAmount: 100,
  expectedAmount: 120,
  countedAmount: 120,
  difference: 0,
  openedAt: '2026-07-22T09:00:00.000Z',
  closedAt: '2026-07-22T18:00:00.000Z',
  closedByUserId: 'owner-a',
  closedByRole: 'owner',
  closedByName: 'Proprietário',
  closeReason: '',
  deviceId: 'device-a',
  legacyStoreId: 'legacy-owner',
  createdAt: '2026-07-22T09:00:00.000Z',
  updatedAt: '2026-07-22T18:00:00.000Z',
  ...overrides,
});

const cashMovement = (
  overrides: Partial<CanonicalCashMovement> = {}
): CanonicalCashMovement => ({
  id: 'cash-movement-a',
  storeId: 'store-a',
  sessionId: 'cash-session-a',
  type: 'income',
  direction: 'in',
  amount: 20,
  description: 'Entrada',
  category: 'Outros',
  reason: '',
  actorUserId: 'owner-a',
  actorRole: 'owner',
  actorName: 'Proprietário',
  source: 'manual',
  paymentId: '',
  deviceId: 'device-a',
  legacyStoreId: 'legacy-owner',
  occurredAt: '2026-07-22T10:00:00.000Z',
  createdAt: '2026-07-22T10:00:00.000Z',
  ...overrides,
});

test('orders are matched by ID and operational content, not timestamps', () => {
  const result = reconcileOrders(
    [order()],
    [order({ storeId: 'store-a', createdAt: '', updatedAt: '' })]
  );
  assert.equal(result.status, 'matched');
  assert.equal(result.issues.length, 0);
});

test('order field differences block canonical read readiness', () => {
  const result = reconcileOrders([order()], [order({ storeId: 'store-a', total: 39 })]);
  assert.equal(result.status, 'divergent');
  assert.match(result.issues[0]?.message ?? '', /diferentes/);
});

test('payments compare received amounts and item allocation', () => {
  const matching = reconcilePayments([payment()], [{
    id: 'payment-a',
    tableCode: '12',
    method: 'pix',
    amount: 20,
    quantity: 1,
    items: payment().items,
  }]);
  assert.equal(matching.status, 'matched');

  const divergent = reconcilePayments([payment()], [{
    id: 'payment-a',
    tableCode: '12',
    method: 'pix',
    amount: 10,
    quantity: 1,
    items: payment().items,
  }]);
  assert.equal(divergent.status, 'divergent');
});

test('archived canonical products remain history and do not create a false divergence', () => {
  const result = reconcileProducts([product()], [
    {
      id: 'product-a',
      name: 'Produto A',
      description: 'Descrição',
      price: 20,
      image: '',
      stock: 3,
      category: 'Geral',
      isService: false,
      publicationStatus: 'published',
    },
    {
      id: 'product-old',
      name: 'Antigo',
      description: '',
      price: 5,
      image: '',
      stock: 0,
      category: 'Geral',
      isService: false,
      publicationStatus: 'archived',
    },
  ]);
  assert.equal(result.status, 'matched');
  assert.equal(result.metrics.find(item => item.label === 'Itens arquivados')?.canonical, 1);
});

test('cash accepts records from other devices but requires every local mapped record', () => {
  const local = {
    sessions: [{
      canonicalId: 'cash-session-a',
      storeId: 'store-a',
      status: 'closed' as const,
      initialCash: 100,
      expectedAmount: 120,
      finalCash: 120,
      difference: 0,
      createSynced: true,
      closeSynced: true,
    }],
    movements: [{
      canonicalId: 'cash-movement-a',
      sessionId: 'cash-session-a',
      legacyStoreId: 'legacy-owner',
      movementType: 'income' as const,
      direction: 'in' as const,
      amount: 20,
      description: 'Entrada',
      category: 'Outros',
      reason: '',
      synced: true,
    }],
    unmappedSessions: 0,
    unmappedMovements: 0,
    pending: 0,
  };

  const matched = reconcileCash(
    local,
    [cashSession(), cashSession({ id: 'cash-session-other' })],
    [cashMovement(), cashMovement({ id: 'cash-movement-other', sessionId: 'cash-session-other' })]
  );
  assert.equal(matched.status, 'matched');

  const missing = reconcileCash(local, [], []);
  assert.equal(missing.status, 'divergent');
  assert.ok(missing.issues.some(issue => issue.entityId === 'cash-session-a'));
});

test('pending and unmapped local cash records remain visible', () => {
  const result = reconcileCash(
    {
      sessions: [],
      movements: [],
      unmappedSessions: 1,
      unmappedMovements: 2,
      pending: 3,
    },
    [],
    []
  );
  assert.equal(result.status, 'divergent');
  assert.equal(result.issues.length, 2);
});
