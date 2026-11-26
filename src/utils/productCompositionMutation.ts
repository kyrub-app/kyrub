import type { ProductComposition, ProductInventorySettings } from './productInventory';

const semanticComposition = (composition: ProductComposition) => JSON.stringify({
  kind: composition.kind,
  yieldQuantity: composition.yieldQuantity,
  lines: composition.lines,
});

export function planProductCompositionEdit(
  current: ProductInventorySettings,
  productId: string,
  baseline: ProductComposition,
  proposed: ProductComposition,
  updatedAt: string
): { settings: ProductInventorySettings; changed: boolean } {
  // An unrelated product save must not overwrite even a newer composition.
  if (semanticComposition(baseline) === semanticComposition(proposed)) {
    return { settings: current, changed: false };
  }
  const actual = current.compositions[productId];
  if (baseline.lines.length === 0 ? Boolean(actual?.lines.length)
    : !actual || semanticComposition(actual) !== semanticComposition(baseline)
      || actual.updatedAt !== baseline.updatedAt) {
    throw new Error('A composição mudou em outra operação. Reabra o produto e revise os componentes.');
  }
  const catalogIds = new Set(current.catalog.map(item => item.id));
  if (proposed.lines.some(line => !catalogIds.has(line.inventoryItemId))) {
    throw new Error('Um componente não está mais no estoque. Reabra o produto e revise a composição.');
  }
  const compositions = { ...current.compositions };
  if (proposed.lines.length > 0) {
    compositions[productId] = { ...proposed, updatedAt };
  } else {
    delete compositions[productId];
  }
  return { settings: { catalog: current.catalog, compositions }, changed: true };
}
