import {
  applyMovingAverageInventoryIntake,
  normalizeInventoryCostBasis,
} from './inventoryCostBasis.js';

export type PricedInventoryItem = {
  id: string;
  purchaseCost: number;
  currentQuantity?: number;
  costBasisStatus?: 'complete' | 'incomplete';
  averageUnitCostMinor?: number | null;
  lastPurchaseUnitCostMinor?: number | null;
  inventoryValueMinor?: number | null;
  costBasisSource?:
    | 'legacy_purchase_cost_seed'
    | 'purchase_receipt'
    | 'inventory_outflow'
    | 'inventory_restoration'
    | 'manual_adjustment'
    | 'unknown';
  costBasisUpdatedAt?: string;
};

export type ProductCostComposition = {
  yieldQuantity: number;
  lines: Array<{ inventoryItemId: string; quantity: number }>;
};

export type InventoryPricingCostSource =
  | 'moving_average'
  | 'last_purchase_reference'
  | 'legacy_purchase_cost'
  | 'incomplete';

export type InventoryPricingCost = {
  unitCost: number | null;
  unitCostMinor: number | null;
  source: InventoryPricingCostSource;
};

export type ProductCostImpact = {
  currentUnitCost: number;
  projectedUnitCost: number;
  unitCostDelta: number;
  unitCostDeltaPercent: number | null;
  currentMarginPercent: number | null;
  projectedMarginPercent: number | null;
  currentSuggestedPrice: number | null;
  projectedSuggestedPrice: number | null;
  currentInventoryUnitCost: number;
  projectedInventoryUnitCost: number;
  projectedPurchaseQuantity: number;
};

const finiteNonNegative = (value: unknown): number | null =>
  typeof value === 'number' && Number.isFinite(value) && value >= 0
    ? value
    : null;

const positive = (value: unknown): number | null => {
  const numeric = finiteNonNegative(value);
  return numeric !== null && numeric > 0 ? numeric : null;
};

const hasExplicitCostBasis = (item: PricedInventoryItem): boolean =>
  item.costBasisStatus !== undefined
  || item.averageUnitCostMinor !== undefined
  || item.lastPurchaseUnitCostMinor !== undefined
  || item.inventoryValueMinor !== undefined
  || item.costBasisSource !== undefined
  || item.costBasisUpdatedAt !== undefined;

export const resolveInventoryPricingCost = (
  item: PricedInventoryItem
): InventoryPricingCost => {
  if (item.costBasisStatus === 'incomplete') {
    return { unitCost: null, unitCostMinor: null, source: 'incomplete' };
  }

  const currentQuantity = finiteNonNegative(item.currentQuantity);
  if (hasExplicitCostBasis(item) && currentQuantity !== null) {
    const basis = normalizeInventoryCostBasis({
      currentQuantity,
      purchaseCost: finiteNonNegative(item.purchaseCost) ?? 0,
      costBasisStatus: item.costBasisStatus,
      averageUnitCostMinor: item.averageUnitCostMinor,
      lastPurchaseUnitCostMinor: item.lastPurchaseUnitCostMinor,
      inventoryValueMinor: item.inventoryValueMinor,
      costBasisSource: item.costBasisSource,
      costBasisUpdatedAt: item.costBasisUpdatedAt,
    });

    if (basis.costBasisStatus === 'incomplete') {
      return { unitCost: null, unitCostMinor: null, source: 'incomplete' };
    }

    if (
      basis.averageUnitCostMinor !== null
      && Number.isFinite(basis.averageUnitCostMinor)
      && basis.averageUnitCostMinor > 0
    ) {
      return {
        unitCost: basis.averageUnitCostMinor / 100,
        unitCostMinor: basis.averageUnitCostMinor,
        source: 'moving_average',
      };
    }

    if (
      currentQuantity === 0
      && basis.lastPurchaseUnitCostMinor !== null
      && Number.isFinite(basis.lastPurchaseUnitCostMinor)
      && basis.lastPurchaseUnitCostMinor > 0
    ) {
      return {
        unitCost: basis.lastPurchaseUnitCostMinor / 100,
        unitCostMinor: basis.lastPurchaseUnitCostMinor,
        source: 'last_purchase_reference',
      };
    }
  }

  const legacyPurchaseCost = positive(item.purchaseCost);
  if (legacyPurchaseCost !== null && !hasExplicitCostBasis(item)) {
    return {
      unitCost: legacyPurchaseCost,
      unitCostMinor: Math.round(legacyPurchaseCost * 100),
      source: 'legacy_purchase_cost',
    };
  }

  return { unitCost: null, unitCostMinor: null, source: 'incomplete' };
};

export const calculateCompositionUnitCost = (
  catalog: PricedInventoryItem[],
  composition: ProductCostComposition
): number | null => {
  if (
    !Number.isFinite(composition.yieldQuantity)
    || composition.yieldQuantity <= 0
    || composition.lines.length === 0
  ) return null;

  const byId = new Map(catalog.map(item => [item.id, item]));
  let total = 0;
  for (const line of composition.lines) {
    const item = byId.get(line.inventoryItemId);
    const pricingCost = item ? resolveInventoryPricingCost(item) : null;
    if (
      !item
      || !pricingCost
      || pricingCost.unitCost === null
      || !Number.isFinite(line.quantity)
      || line.quantity <= 0
    ) return null;
    total += line.quantity * pricingCost.unitCost;
  }

  const cost = total / composition.yieldQuantity;
  return Number.isFinite(cost) && cost >= 0 ? cost : null;
};

export const calculateSuggestedPrice = (
  unitCost: number | null,
  targetMarginPercent: number | null
): number | null => {
  if (
    unitCost === null
    || targetMarginPercent === null
    || !Number.isFinite(unitCost)
    || !Number.isFinite(targetMarginPercent)
    || unitCost < 0
    || targetMarginPercent < 0
    || targetMarginPercent >= 100
  ) return null;

  const price = unitCost / (1 - targetMarginPercent / 100);
  return Number.isFinite(price) ? price : null;
};

export const calculateSaleMarginPercent = (
  unitCost: number | null,
  salePrice: number | null
): number | null => {
  if (
    unitCost === null
    || salePrice === null
    || !Number.isFinite(unitCost)
    || !Number.isFinite(salePrice)
    || unitCost < 0
    || salePrice <= 0
  ) return null;
  return ((salePrice - unitCost) / salePrice) * 100;
};

export const calculateMarginGapPercentagePoints = (
  actualMarginPercent: number | null,
  targetMarginPercent: number | null
): number | null => {
  if (
    actualMarginPercent === null
    || targetMarginPercent === null
    || !Number.isFinite(actualMarginPercent)
    || !Number.isFinite(targetMarginPercent)
    || targetMarginPercent < 0
    || targetMarginPercent >= 100
  ) return null;
  return actualMarginPercent - targetMarginPercent;
};

export const calculateProductCostImpact = (
  catalog: PricedInventoryItem[],
  composition: ProductCostComposition,
  inventoryItemId: string,
  projectedPurchaseCost: number | null,
  projectedPurchaseQuantity: number | null,
  currentSalePrice: number | null,
  targetMarginPercent: number | null
): ProductCostImpact | null => {
  const normalizedId = inventoryItemId.trim();
  const purchaseCost = positive(projectedPurchaseCost);
  const purchaseQuantity = positive(projectedPurchaseQuantity);
  if (
    !normalizedId
    || purchaseCost === null
    || purchaseQuantity === null
    || !composition.lines.some(line => line.inventoryItemId === normalizedId)
  ) return null;

  const currentUnitCost = calculateCompositionUnitCost(catalog, composition);
  const currentInventoryItem = catalog.find(item => item.id === normalizedId);
  const currentInventoryCost = currentInventoryItem
    ? resolveInventoryPricingCost(currentInventoryItem)
    : null;
  if (
    currentUnitCost === null
    || !currentInventoryItem
    || !currentInventoryCost
    || currentInventoryCost.unitCost === null
  ) return null;

  const currentQuantity = finiteNonNegative(currentInventoryItem.currentQuantity);
  const projectedInventoryItem = currentQuantity === null
    ? { ...currentInventoryItem, purchaseCost }
    : applyMovingAverageInventoryIntake(
        {
          ...currentInventoryItem,
          currentQuantity,
          purchaseCost: finiteNonNegative(currentInventoryItem.purchaseCost) ?? 0,
        },
        {
          quantity: purchaseQuantity,
          resultingQuantity: currentQuantity + purchaseQuantity,
          unitCostMinor: Math.round(purchaseCost * 100),
          source: 'purchase_receipt',
        }
      ).item;

  const projectedInventoryCost = resolveInventoryPricingCost(projectedInventoryItem);
  if (projectedInventoryCost.unitCost === null) return null;

  const projectedCatalog = catalog.map(item =>
    item.id === normalizedId ? projectedInventoryItem : item
  );
  const projectedUnitCost = calculateCompositionUnitCost(
    projectedCatalog,
    composition
  );
  if (projectedUnitCost === null) return null;

  const unitCostDelta = projectedUnitCost - currentUnitCost;
  return {
    currentUnitCost,
    projectedUnitCost,
    unitCostDelta,
    unitCostDeltaPercent: currentUnitCost > 0
      ? (unitCostDelta / currentUnitCost) * 100
      : null,
    currentMarginPercent: calculateSaleMarginPercent(
      currentUnitCost,
      currentSalePrice
    ),
    projectedMarginPercent: calculateSaleMarginPercent(
      projectedUnitCost,
      currentSalePrice
    ),
    currentSuggestedPrice: calculateSuggestedPrice(
      currentUnitCost,
      targetMarginPercent
    ),
    projectedSuggestedPrice: calculateSuggestedPrice(
      projectedUnitCost,
      targetMarginPercent
    ),
    currentInventoryUnitCost: currentInventoryCost.unitCost,
    projectedInventoryUnitCost: projectedInventoryCost.unitCost,
    projectedPurchaseQuantity: purchaseQuantity,
  };
};

export const roundCurrency = (value: number): number =>
  Math.round((value + Number.EPSILON) * 100) / 100;
