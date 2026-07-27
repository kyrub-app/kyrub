import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import type { Product } from '../src/types';
import type { PublicProduct } from '../src/utils/publicProducts';
import {
  mergeCloudProductsIntoLegacyCache,
  parseLegacyProductCache,
  productCacheSignature,
} from '../src/utils/productCrossDeviceSync';

const product = (
  id: string,
  supplierId: string,
  overrides: Partial<Product> = {}
): Product => ({
  id,
  supplierId,
  name: id,
  description: '',
  price: 10,
  image: '',
  stock: 1,
  category: 'Categoria',
  ...overrides,
});

const cloudProduct = (id: string, ownerId: string): PublicProduct => ({
  ...product(id, ownerId),
  storeId: ownerId,
  supplierId: ownerId,
  updatedAt: '2026-07-27T00:00:00.000Z',
});

test('replaces only the authenticated store retail products with cloud data', () => {
  const cached = [
    product('old-owned', 'owner-a'),
    product('wholesale-owned', 'owner-a', { wholesalePrice: 8 }),
    product('other-store', 'owner-b'),
  ];
  const cloud = [cloudProduct('new-owned', 'owner-a')];

  const merged = mergeCloudProductsIntoLegacyCache(cached, cloud, 'owner-a');

  assert.deepEqual(
    merged.map(item => item.id),
    ['new-owned', 'wholesale-owned', 'other-store']
  );
});

test('an empty authoritative cloud list removes stale owned retail products', () => {
  const merged = mergeCloudProductsIntoLegacyCache(
    [product('stale-owned', 'owner-a'), product('other-store', 'owner-b')],
    [],
    'owner-a'
  );

  assert.deepEqual(merged.map(item => item.id), ['other-store']);
});

test('cache signatures are stable when product order changes', () => {
  const left = [product('b', 'owner-a'), product('a', 'owner-a')];
  const right = [product('a', 'owner-a'), product('b', 'owner-a')];

  assert.equal(productCacheSignature(left), productCacheSignature(right));
});

test('invalid browser cache falls back to an empty product list', () => {
  assert.deepEqual(parseLegacyProductCache('{invalid'), []);
  assert.deepEqual(parseLegacyProductCache(null), []);
});

test('runtime bridge ignores cache-only snapshots and remounts shared legacy state after cloud hydration', () => {
  const bridge = readFileSync(
    'src/components/store/ProductCrossDeviceSyncBridge.tsx',
    'utf8'
  );
  const app = readFileSync('src/App.tsx', 'utf8');

  assert.match(bridge, /snapshot\.metadata\.fromCache/);
  assert.match(bridge, /snapshot\.metadata\.hasPendingWrites/);
  assert.match(bridge, /mergeCloudProductsIntoLegacyCache/);
  assert.match(bridge, /kyrub-products-cloud-cache-updated/);
  assert.match(app, /ProductCrossDeviceSyncBridge/);
  assert.match(app, /setLegacyCacheRevision\(current => current \+ 1\)/);
  assert.match(app, /<LegacyApp key=\{`legacy-cache-\$\{legacyCacheRevision\}`\}/);
});