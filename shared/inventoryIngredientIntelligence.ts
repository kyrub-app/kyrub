import type {
  InventoryCatalogRecord,
  InventoryCompositionRecord,
} from './inventoryConsumption';

export interface IngredientStockView {
  id: string;
  name: string;
  unit: string;
  currentQuantity: number;
  minimumQuantity: number;
  availableQuantity: number;
  reservedQuantity: number;
  status: 'out' | 'low' | 'ok';
  usedByProductIds: string[];
}

export interface IngredientDemandLine {
  inventoryItemId: string;
  inventoryItemName: string;
  unit: string;
  requiredQuantity: number;
  availableQuantity: number;
  shortageQuantity: number;
  productIds: string[];
}

const round = (value: number): number =>
  Math.round((value + Number.EPSILON) * 1_000_000) / 1_000_000;

const normalized = (value: string): string =>
  value.normalize('NFD').replace(/[\u0300-\u036f]/g, '').trim().toLocaleLowerCase('pt-BR');

const aliases = (item: InventoryCatalogRecord): string[] => {
  const name = normalized(item.name);
  return [normalized(item.id), name, ...name.split(/\s+/).filter(part => part.length >= 3)];
};

export const inventoryIngredientViews = (
  catalog: InventoryCatalogRecord[],
  compositions: Record<string, InventoryCompositionRecord>,
  reservedByItemId: Record<string, number> = {}
): IngredientStockView[] => {
  const productsByIngredient = new Map<string, Set<string>>();
  for (const [productId, composition] of Object.entries(compositions)) {
    for (const line of composition.lines) {
      const current = productsByIngredient.get(line.inventoryItemId) ?? new Set<string>();
      current.add(productId);
      productsByIngredient.set(line.inventoryItemId, current);
    }
  }

  return catalog.map(item => {
    const reservedQuantity = Math.max(0, reservedByItemId[item.id] ?? 0);
    const availableQuantity = round(Math.max(0, item.currentQuantity - reservedQuantity));
    return {
      id: item.id,
      name: item.name,
      unit: item.unit,
      currentQuantity: item.currentQuantity,
      minimumQuantity: item.minimumQuantity,
      availableQuantity,
      reservedQuantity: round(reservedQuantity),
      status: availableQuantity <= 0
        ? 'out'
        : availableQuantity <= item.minimumQuantity ? 'low' : 'ok',
      usedByProductIds: [...(productsByIngredient.get(item.id) ?? [])].sort(),
    } satisfies IngredientStockView;
  });
};

export const findInventoryIngredients = (
  query: string,
  catalog: InventoryCatalogRecord[],
  compositions: Record<string, InventoryCompositionRecord>,
  reservedByItemId: Record<string, number> = {}
): IngredientStockView[] => {
  const terms = normalized(query).split(/\s+/).filter(Boolean);
  if (terms.length === 0) return [];
  return inventoryIngredientViews(catalog, compositions, reservedByItemId)
    .filter(view => {
      const item = catalog.find(candidate => candidate.id === view.id);
      if (!item) return false;
      const searchable = aliases(item);
      return terms.every(term => searchable.some(alias => alias.includes(term)));
    })
    .sort((left, right) => left.name.localeCompare(right.name, 'pt-BR'));
};

export const calculateIngredientDemand = (
  requestedProducts: Array<{ productId: string; quantity: number }>,
  catalog: InventoryCatalogRecord[],
  compositions: Record<string, InventoryCompositionRecord>
): IngredientDemandLine[] => {
  const catalogById = new Map(catalog.map(item => [item.id, item]));
  const demand = new Map<string, { required: number; productIds: Set<string> }>();

  for (const requested of requestedProducts) {
    if (!Number.isFinite(requested.quantity) || requested.quantity <= 0) continue;
    const composition = compositions[requested.productId];
    if (!composition) continue;
    for (const line of composition.lines) {
      const current = demand.get(line.inventoryItemId) ?? {
        required: 0,
        productIds: new Set<string>(),
      };
      current.required = round(
        current.required + line.quantity * requested.quantity / composition.yieldQuantity
      );
      current.productIds.add(requested.productId);
      demand.set(line.inventoryItemId, current);
    }
  }

  return [...demand.entries()].map(([inventoryItemId, value]) => {
    const item = catalogById.get(inventoryItemId);
    if (!item) throw new Error(`Ingrediente ${inventoryItemId} não existe no catálogo de estoque.`);
    return {
      inventoryItemId,
      inventoryItemName: item.name,
      unit: item.unit,
      requiredQuantity: value.required,
      availableQuantity: item.currentQuantity,
      shortageQuantity: round(Math.max(0, value.required - item.currentQuantity)),
      productIds: [...value.productIds].sort(),
    } satisfies IngredientDemandLine;
  }).sort((left, right) => left.inventoryItemName.localeCompare(right.inventoryItemName, 'pt-BR'));
};