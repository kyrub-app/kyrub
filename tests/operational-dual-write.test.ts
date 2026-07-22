import assert from 'node:assert/strict';
import test from 'node:test';
import type { CustomerOrder } from '../src/utils/customerOrders';
import {
  buildCanonicalOrderMirrorData,
  buildCanonicalPaymentMirrorData,
  parseLegacyTablePayment,
  selectCanonicalStoreForLegacyTenant,
} from '../src/utils/operationalDualWrite';
import type { CanonicalStoreRecord } from '../src/utils/storeDirectory';

const legacyOrder: CustomerOrder = {
  id: 'customer-order-buyer-a-1',
  storeId: 'owner-a',
  buyerId: 'buyer-a',
  buyerName: 'Cliente A',
  buyerEmail: 'buyer@example.com',
  fulfillmentType: 'dine_in',
  deliveryAddress: '',
  tableCode: '12',
  customerNote: 'Sem gelo',
  items: [
    {
      lineId: 'line-a',
      productId: 'product-a',
      name: 'Produto A',
      price: 20,
      quantity: 2,
      paidQuantity: 0,
      transferredQuantity: 0,
      note: '',
      image: '',
      isService: false,
    },
  ],
  subtotal: 40,
  total: 40,
  status: 'pending',
  paymentStatus: 'unpaid',
  source: 'customer',
  operatorId: '',
  operatorName: '',
  createdAt: '2026-07-22T10:00:00.000Z',
  updatedAt: '2026-07-22T10:00:00.000Z',
};

const canonicalStore = (
  id: string,
  legacyTenantId = 'owner-a'
): CanonicalStoreRecord => ({
  id,
  ownerId: 'owner-a',
  name: 'Loja A',
  publicationStatus: 'paused',
  plan: 'free',
  legacyTenantId,
  migrationStatus: 'registry_only',
  createdAt: '2026-07-22T09:00:00.000Z',
  updatedAt: '2026-07-22T09:00:00.000Z',
});

test('selects the unique independent store linked to the legacy tenant', () => {
  const selected = selectCanonicalStoreForLegacyTenant(
    [canonicalStore('store-a'), canonicalStore('store-b', 'another-owner')],
    'owner-a',
    'owner-a'
  );

  assert.equal(selected?.id, 'store-a');
});

test('rejects ambiguous legacy mappings', () => {
  assert.throws(
    () =>
      selectCanonicalStoreForLegacyTenant(
        [canonicalStore('store-a'), canonicalStore('store-b')],
        'owner-a',
        'owner-a'
      ),
    /Mais de uma loja canônica/
  );
});

test('builds a customer order mirror without replacing the original buyer actor', () => {
  const mirrored = buildCanonicalOrderMirrorData(
    legacyOrder,
    'store-independent-a',
    'owner-a'
  );

  assert.equal(mirrored.storeId, 'store-independent-a');
  assert.equal(mirrored.legacyStoreId, 'owner-a');
  assert.equal(mirrored.createdByUserId, 'buyer-a');
  assert.equal(mirrored.createdByRole, 'customer');
  assert.equal(mirrored.migration.migratedByUserId, 'owner-a');
  assert.equal(mirrored.migration.migratedByRole, 'owner');
  assert.match(mirrored.migratedFromPath, /artifacts\/owner-a/);
});

test('requires an independent canonical store id', () => {
  assert.throws(
    () => buildCanonicalOrderMirrorData(legacyOrder, 'owner-a', 'owner-a'),
    /storeId independente/
  );
});

test('parses and maps a legacy table payment to the canonical store', () => {
  const parsed = parseLegacyTablePayment(
    {
      id: 'payment-a',
      storeId: 'owner-a',
      tableCode: '12',
      method: 'pix',
      amount: 20,
      quantity: 1,
      items: [
        {
          orderId: legacyOrder.id,
          lineId: 'line-a',
          productId: 'product-a',
          name: 'Produto A',
          quantity: 1,
          unitPrice: 20,
          total: 20,
        },
      ],
      operatorId: 'owner-a',
      operatorName: 'Proprietário',
      createdAt: '2026-07-22T10:10:00.000Z',
    },
    'fallback-id'
  );

  assert.ok(parsed);
  const mirrored = buildCanonicalPaymentMirrorData(
    parsed,
    'store-independent-a',
    'owner-a'
  );
  assert.equal(mirrored.storeId, 'store-independent-a');
  assert.equal(mirrored.legacyStoreId, 'owner-a');
  assert.equal(mirrored.actorUserId, 'owner-a');
  assert.equal(mirrored.actorRole, 'owner');
  assert.equal(mirrored.amount, 20);
});

test('rejects malformed legacy payments', () => {
  assert.equal(
    parseLegacyTablePayment({
      storeId: 'owner-a',
      tableCode: '12',
      method: 'cash',
      amount: -1,
      quantity: 0,
      items: [],
      operatorId: 'owner-a',
    }),
    null
  );
});
