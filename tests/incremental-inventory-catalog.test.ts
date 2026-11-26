import assert from 'node:assert/strict';
import { test } from 'node:test';
import { applyCatalogMutation } from '../src/utils/storeInventoryCatalogMutation';
import type { InventoryCatalogItem } from '../src/utils/productInventory';

const item: InventoryCatalogItem = { id: 'a', name: 'Farinha', unit: 'kg', currentQuantity: 10, minimumQuantity: 2, purchaseCost: 5, supplier: 'A', updatedAt: 'old', costBasisStatus: 'complete', averageUnitCostMinor: 500, lastPurchaseUnitCostMinor: 500, inventoryValueMinor: 5000, costBasisSource: 'purchase_receipt', costBasisUpdatedAt: 'old' };
const other = { ...item, id: 'b', name: 'Embalagem' };
const live: InventoryCatalogItem = { ...item, currentQuantity: 7, inventoryValueMinor: 3500, costBasisSource: 'inventory_outflow', costBasisUpdatedAt: 'new', updatedAt: 'new' };
const metadata = { name: 'Farinha premium', minimumQuantity: 3, purchaseCost: 5, supplier: 'A', updatedAt: 'edit' };

test('editing metadata preserves intervening sales and valuation', () => {
  const next = applyCatalogMutation([live, other], { kind: 'edit', expected: item, metadata });
  assert.deepEqual(next, [{ ...live, ...metadata }, other]);
});
test('new item does not erase other concurrent additions or movements', () => {
  const created = { ...item, id: 'c' };
  assert.deepEqual(applyCatalogMutation([live, other], { kind: 'create', item: created }), [live, other, created]);
  assert.throws(() => applyCatalogMutation([live], { kind: 'create', item }));
});
test('rejects edits of deleted items or conflicting metadata', () => {
  assert.throws(() => applyCatalogMutation([], { kind: 'edit', expected: item, metadata }));
  assert.throws(() => applyCatalogMutation([{ ...live, purchaseCost: 6 }], { kind: 'edit', expected: item, metadata }));
});
test('rejects removal after inventory changed and only removes confirmed item', () => {
  assert.throws(() => applyCatalogMutation([live, other], { kind: 'remove', expected: item }));
  assert.deepEqual(applyCatalogMutation([live, other], { kind: 'remove', expected: live }), [other]);
});
