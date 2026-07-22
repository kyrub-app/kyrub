import assert from 'node:assert/strict';
import test from 'node:test';
import {
  buildCanonicalProductMirrorData,
  canonicalProductNeedsUpdate,
  getCanonicalProductIdsToArchive,
  parseLegacyPublicProductsForStore,
  selectLegacyPublicProductsForStore,
} from '../src/utils/canonicalProductDualWrite';
import type { PublicProduct } from '../src/utils/publicProducts';

const legacyProduct = (
  overrides: Partial<PublicProduct> = {}
): PublicProduct => ({
  id: 'product-owner-a-1',
  storeId: 'owner-a',
  supplierId: 'owner-a',
  name: 'Produto A',
  description: 'Descrição real',
  price: 25,
  image: '',
  stock: 4,
  category: 'Geral',
  isService: false,
  updatedAt: '2026-07-22T10:00:00.000Z',
  ...overrides,
});

test('builds a canonical product with independent store identity and migration provenance', () => {
  const mirrored = buildCanonicalProductMirrorData(
    legacyProduct(),
    'store-independent-a',
    'owner-a'
  );

  assert.equal(mirrored.storeId, 'store-independent-a');
  assert.equal(mirrored.supplierId, 'store-independent-a');
  assert.equal(mirrored.legacyStoreId, 'owner-a');
  assert.equal(mirrored.legacyProductId, 'product-owner-a-1');
  assert.equal(mirrored.publicationStatus, 'published');
  assert.equal(mirrored.migration.mode, 'dual_write');
  assert.equal(mirrored.migration.migratedByUserId, 'owner-a');
  assert.equal(
    mirrored.migratedFromPath,
    'tenants/owner-a#publicProducts/product-owner-a-1'
  );
});

test('services are mirrored with zero stock', () => {
  const mirrored = buildCanonicalProductMirrorData(
    legacyProduct({ isService: true, stock: 12 }),
    'store-independent-a',
    'owner-a'
  );

  assert.equal(mirrored.stock, 0);
  assert.equal(mirrored.isService, true);
});

test('rejects reused owner uid and products from another legacy store', () => {
  assert.throws(
    () => buildCanonicalProductMirrorData(legacyProduct(), 'owner-a', 'owner-a'),
    /storeId independente/
  );

  assert.throws(
    () =>
      selectLegacyPublicProductsForStore(
        [legacyProduct({ supplierId: 'another-owner' })],
        'owner-a'
      ),
    /não pertence/
  );
});

test('rejects duplicated and malformed legacy products before migration', () => {
  const product = legacyProduct();
  assert.throws(
    () => selectLegacyPublicProductsForStore([product, product], 'owner-a'),
    /duplicado/
  );

  assert.throws(
    () =>
      parseLegacyPublicProductsForStore(
        [{ ...product, price: Number.NaN }],
        'owner-a'
      ),
    /dados inválidos/
  );
});

test('detects updates without rewriting an unchanged canonical product', () => {
  const mirrored = buildCanonicalProductMirrorData(
    legacyProduct(),
    'store-independent-a',
    'owner-a'
  );

  assert.equal(
    canonicalProductNeedsUpdate(
      mirrored as unknown as Record<string, unknown>,
      mirrored
    ),
    false
  );
  assert.equal(
    canonicalProductNeedsUpdate(
      { ...mirrored, price: 30 } as unknown as Record<string, unknown>,
      mirrored
    ),
    true
  );
});

test('archives only missing products that belong to the same legacy migration', () => {
  const products = [
    {
      id: 'keep',
      data: {
        legacyStoreId: 'owner-a',
        publicationStatus: 'published',
        migration: { mode: 'dual_write' },
      },
    },
    {
      id: 'archive',
      data: {
        legacyStoreId: 'owner-a',
        publicationStatus: 'published',
        migration: { mode: 'dual_write' },
      },
    },
    {
      id: 'already-archived',
      data: {
        legacyStoreId: 'owner-a',
        publicationStatus: 'archived',
        migration: { mode: 'dual_write' },
      },
    },
    {
      id: 'another-store',
      data: {
        legacyStoreId: 'owner-b',
        publicationStatus: 'published',
        migration: { mode: 'dual_write' },
      },
    },
  ];

  assert.deepEqual(
    getCanonicalProductIdsToArchive(products, new Set(['keep']), 'owner-a'),
    ['archive']
  );
});
