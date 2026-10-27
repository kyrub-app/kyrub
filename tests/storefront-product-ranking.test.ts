import assert from 'node:assert/strict';
import test from 'node:test';
import type { Product } from '../src/types';
import { sortByBestSellers } from '../src/utils/storefrontProductRanking';

const product = (id: string): Product => ({
  id, name: id, description: '', price: 10, image: id + '.jpg',
  stock: 1, category: 'Teste',
});

test('Mais vendido excludes products without recorded sales', () => {
  const products = [product('a'), product('b'), product('c')];
  const result = sortByBestSellers(products, { a: 0, b: 3, c: 1 });
  assert.deepEqual(result.map(item => item.id), ['b', 'c']);
});

test('Mais vendido returns an empty list before the first sale', () => {
  assert.deepEqual(sortByBestSellers([product('a')], {}), []);
});

test('Mais vendido sorts by units sold without mutating input', () => {
  const products = [product('a'), product('b')];
  const result = sortByBestSellers(products, { a: 2, b: 5 });
  assert.deepEqual(result.map(item => item.id), ['b', 'a']);
  assert.deepEqual(products.map(item => item.id), ['a', 'b']);
});
