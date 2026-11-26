import type { InventoryCatalogItem } from './productInventory';

type Metadata = Pick<InventoryCatalogItem, 'name' | 'minimumQuantity' | 'purchaseCost' | 'supplier' | 'updatedAt'>;
export type CatalogMutation =
  | { kind: 'create'; item: InventoryCatalogItem }
  | { kind: 'edit'; expected: InventoryCatalogItem; metadata: Metadata }
  | { kind: 'remove'; expected: InventoryCatalogItem };

const sameMetadata = (a: InventoryCatalogItem, b: InventoryCatalogItem) =>
  a.id === b.id && a.name === b.name && a.unit === b.unit
  && a.minimumQuantity === b.minimumQuantity && a.purchaseCost === b.purchaseCost
  && a.supplier === b.supplier;

// Compare the economic and physical fields for a destructive operation.
const sameInventory = (a: InventoryCatalogItem, b: InventoryCatalogItem) =>
  sameMetadata(a, b) && a.currentQuantity === b.currentQuantity
  && a.updatedAt === b.updatedAt && a.costBasisStatus === b.costBasisStatus
  && a.averageUnitCostMinor === b.averageUnitCostMinor
  && a.lastPurchaseUnitCostMinor === b.lastPurchaseUnitCostMinor
  && a.inventoryValueMinor === b.inventoryValueMinor
  && a.costBasisSource === b.costBasisSource && a.costBasisUpdatedAt === b.costBasisUpdatedAt;

export function applyCatalogMutation(current: InventoryCatalogItem[], mutation: CatalogMutation): InventoryCatalogItem[] {
  if (mutation.kind === 'create') {
    if (current.some(item => item.id === mutation.item.id)) throw new Error('Este item já existe. Atualize o estoque.');
    return [...current, mutation.item];
  }
  const existing = current.find(item => item.id === mutation.expected.id);
  if (!existing || !sameMetadata(existing, mutation.expected)) {
    throw new Error('O cadastro mudou em outra operação. Reabra o item e revise os dados.');
  }
  if (mutation.kind === 'remove') {
    if (!sameInventory(existing, mutation.expected)) {
      throw new Error('O estoque mudou. Confira o saldo antes de confirmar a remoção novamente.');
    }
    return current.filter(item => item.id !== existing.id);
  }
  // Only edited metadata can change; use the latest physical and valuation fields.
  const { name, minimumQuantity, purchaseCost, supplier, updatedAt } = mutation.metadata;
  return current.map(item => item.id === existing.id
    ? { ...item, name, minimumQuantity, purchaseCost, supplier, updatedAt }
    : item);
}
