import test from 'node:test';
import assert from 'node:assert/strict';
import {
  canEnableCanonicalReadDomain,
  chooseCanonicalReadSource,
  parseCanonicalReadConfig,
} from '../src/utils/canonicalReadCutover';
import {
  customerOrderCollectionsEquivalent,
  type CustomerOrder,
} from '../src/utils/customerOrders';
import {
  publicProductCollectionsEquivalent,
  type PublicProduct,
} from '../src/utils/publicProducts';
import { tablePaymentCollectionsEquivalent } from '../src/utils/canonicalPaymentReads';
import type { LegacyTablePaymentRecord } from '../src/utils/operationalDualWrite';
import type { MigrationReconciliationReport } from '../src/utils/migrationReconciliation';

const product: PublicProduct = {
  id: 'product-1',
  storeId: 'legacy-store',
  supplierId: 'legacy-store',
  name: 'Café',
  description: 'Café coado',
  price: 7.5,
  image: '',
  stock: 10,
  category: 'Bebidas',
  isService: false,
  updatedAt: '2026-07-22T10:00:00.000Z',
};

const order: CustomerOrder = {
  id: 'order-1',
  storeId: 'legacy-store',
  buyerId: 'buyer-1',
  buyerName: 'Cliente',
  buyerEmail: 'cliente@example.com',
  fulfillmentType: 'dine_in',
  deliveryAddress: '',
  tableCode: '12',
  customerNote: '',
  items: [{
    lineId: 'line-1',
    productId: 'product-1',
    name: 'Café',
    price: 7.5,
    quantity: 1,
    paidQuantity: 0,
    transferredQuantity: 0,
    note: '',
    image: '',
    isService: false,
  }],
  subtotal: 7.5,
  total: 7.5,
  status: 'pending',
  paymentStatus: 'unpaid',
  source: 'customer',
  operatorId: '',
  operatorName: '',
  createdAt: '2026-07-22T10:00:00.000Z',
  updatedAt: '2026-07-22T10:00:00.000Z',
};

const payment: LegacyTablePaymentRecord = {
  id: 'payment-1',
  legacyStoreId: 'legacy-store',
  tableCode: '12',
  method: 'pix',
  amount: 7.5,
  quantity: 1,
  items: [{
    orderId: 'order-1',
    lineId: 'line-1',
    productId: 'product-1',
    name: 'Café',
    quantity: 1,
    unitPrice: 7.5,
    total: 7.5,
  }],
  operatorId: 'owner-1',
  operatorName: 'Proprietário',
  createdAt: '2026-07-22T10:05:00.000Z',
};

const report = (status: 'matched' | 'divergent'): MigrationReconciliationReport => ({
  store: {
    id: 'canonical-store',
    ownerId: 'legacy-store',
    name: 'Loja',
    publicationStatus: 'published',
    plan: 'free',
    legacyTenantId: 'legacy-store',
    migrationStatus: 'dual_write',
    createdAt: '',
    updatedAt: '',
  },
  legacyStoreId: 'legacy-store',
  checkedAt: '',
  readyForCanonicalRead: status === 'matched',
  matchedSections: status === 'matched' ? 4 : 3,
  divergentSections: status === 'matched' ? 0 : 1,
  unavailableSections: 0,
  sections: [
    {
      key: 'products',
      title: 'Produtos',
      status,
      coverage: '',
      metrics: [],
      issues: [],
    },
    {
      key: 'orders',
      title: 'Pedidos',
      status: 'matched',
      coverage: '',
      metrics: [],
      issues: [],
    },
    {
      key: 'payments',
      title: 'Pagamentos',
      status: 'matched',
      coverage: '',
      metrics: [],
      issues: [],
    },
    {
      key: 'cash',
      title: 'Caixa',
      status: 'matched',
      coverage: '',
      metrics: [],
      issues: [],
    },
  ],
});

test('canonical read config is disabled by default and preserves explicit flags', () => {
  assert.deepEqual(parseCanonicalReadConfig(undefined), {
    canonicalStoreId: '',
    preferences: { products: false, orders: false, payments: false },
  });
  assert.deepEqual(
    parseCanonicalReadConfig({
      canonicalStoreId: 'canonical-store',
      canonicalReadPreferences: { products: true, orders: false, payments: true },
    }),
    {
      canonicalStoreId: 'canonical-store',
      preferences: { products: true, orders: false, payments: true },
    }
  );
});

test('canonical source is used only when enabled, available and equivalent', () => {
  assert.deepEqual(
    chooseCanonicalReadSource(true, 'canonical-store', 'available', true),
    { source: 'canonical', reason: 'canonical' }
  );
  assert.deepEqual(
    chooseCanonicalReadSource(true, 'canonical-store', 'available', false),
    { source: 'legacy', reason: 'divergent' }
  );
  assert.deepEqual(
    chooseCanonicalReadSource(true, 'canonical-store', 'unavailable', true),
    { source: 'legacy', reason: 'unavailable' }
  );
  assert.deepEqual(
    chooseCanonicalReadSource(false, 'canonical-store', 'available', true),
    { source: 'legacy', reason: 'disabled' }
  );
});

test('a domain can be enabled only after its reconciliation is matched', () => {
  assert.equal(canEnableCanonicalReadDomain(report('matched'), 'products'), true);
  assert.equal(canEnableCanonicalReadDomain(report('divergent'), 'products'), false);
  assert.equal(canEnableCanonicalReadDomain(report('divergent'), 'orders'), true);
});

test('product comparison ignores timestamps but detects operational changes', () => {
  assert.equal(
    publicProductCollectionsEquivalent(
      [product],
      [{ ...product, updatedAt: 'different-timestamp' }]
    ),
    true
  );
  assert.equal(
    publicProductCollectionsEquivalent([product], [{ ...product, stock: 9 }]),
    false
  );
});

test('order comparison ignores timestamps and store mapping but detects status changes', () => {
  assert.equal(
    customerOrderCollectionsEquivalent(
      [order],
      [{ ...order, storeId: 'canonical-store', createdAt: '', updatedAt: '' }]
    ),
    true
  );
  assert.equal(
    customerOrderCollectionsEquivalent([order], [{ ...order, status: 'accepted' }]),
    false
  );
});

test('payment comparison detects method and allocation differences', () => {
  assert.equal(
    tablePaymentCollectionsEquivalent(
      [payment],
      [{ ...payment, legacyStoreId: 'canonical-store', createdAt: '' }]
    ),
    true
  );
  assert.equal(
    tablePaymentCollectionsEquivalent([payment], [{ ...payment, method: 'cash' }]),
    false
  );
});
