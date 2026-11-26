import assert from 'node:assert/strict';
import { test } from 'node:test';
import { planProductCompositionEdit } from '../src/utils/productCompositionMutation';
import type { InventoryCatalogItem, ProductComposition, ProductInventorySettings } from '../src/utils/productInventory';

const item: InventoryCatalogItem = { id: 'a', name: 'Farinha', unit: 'kg', currentQuantity: 7, minimumQuantity: 2, purchaseCost: 5, supplier: '', updatedAt: 'sale', costBasisStatus: 'complete', averageUnitCostMinor: 500, inventoryValueMinor: 3500 };
const baseline: ProductComposition = { kind: 'recipe', yieldQuantity: 1, lines: [{ inventoryItemId: 'a', quantity: 1 }], updatedAt: 'old' };
const proposed = { ...baseline, lines: [{ inventoryItemId: 'a', quantity: 2 }] };
const empty: ProductComposition = { ...baseline, lines: [], updatedAt: '' };
const other = { ...baseline, yieldQuantity: 3 };
const current: ProductInventorySettings = { catalog: [item], compositions: { p: baseline, q: other } };

test('composition edit preserves current inventory valuation and other products', () => {
  const result = planProductCompositionEdit(current, 'p', baseline, proposed, 'new');
  assert.equal(result.changed, true);
  assert.deepEqual(result.settings.catalog, [item]);
  assert.deepEqual(result.settings.compositions, { p: { ...proposed, updatedAt: 'new' }, q: other });
});
test('unmodified draft is a no-op even if another editor changed composition', () => {
  const live = { ...current, compositions: { p: proposed, q: other } };
  assert.deepEqual(planProductCompositionEdit(live, 'p', baseline, baseline, 'new'), { settings: live, changed: false });
});
test('rejects concurrent edits, even when the content was changed and restored', () => {
  assert.throws(() => planProductCompositionEdit({ ...current, compositions: { p: { ...baseline, updatedAt: 'concurrent' } } }, 'p', baseline, proposed, 'new'));
  assert.throws(() => planProductCompositionEdit({ ...current, compositions: {} }, 'p', baseline, proposed, 'new'));
});
test('rejects references to removed inventory items', () => {
  assert.throws(() => planProductCompositionEdit({ ...current, catalog: [] }, 'p', baseline, proposed, 'new'));
});
test('explicit deletion changes only the selected product', () => {
  assert.deepEqual(planProductCompositionEdit(current, 'p', baseline, empty, 'new').settings, { catalog: [item], compositions: { q: other } });
});
test('conditional compensation preserves newer edits and stock movements', () => {
  const saved = planProductCompositionEdit(current, 'p', baseline, proposed, 'new').settings;
  const moved = { ...saved, catalog: [{ ...item, currentQuantity: 4, inventoryValueMinor: 2000 }] };
  const restored = planProductCompositionEdit(moved, 'p', saved.compositions.p, baseline, 'rollback').settings;
  assert.deepEqual(restored.catalog, moved.catalog);
  assert.equal(restored.compositions.p.lines[0].quantity, 1);
  assert.throws(() => planProductCompositionEdit({ ...moved, compositions: { ...moved.compositions, p: { ...proposed, updatedAt: 'newer' } } }, 'p', saved.compositions.p, baseline, 'rollback'));
});
