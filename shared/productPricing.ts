export type PricedInventoryItem = {
  id: string;
  purchaseCost: number;
};

export type ProductCostComposition = {
  yieldQuantity: number;
  lines: Array<{ inventoryItemId: string; quantity: number }>;
};

export const calculateCompositionUnitCost = (
  catalog: PricedInventoryItem[],
  composition: ProductCostComposition
): number | null => {
  if (
    !Number.isFinite(composition.yieldQuantity) ||
    composition.yieldQuantity <= 0 ||
    composition.lines.length === 0
  ) return null;

  const byId = new Map(catalog.map(item => [item.id, item]));
  let total = 0;
  for (const line of composition.lines) {
    const item = byId.get(line.inventoryItemId);
    if (
      !item ||
      !Number.isFinite(line.quantity) ||
      line.quantity <= 0 ||
      !Number.isFinite(item.purchaseCost) ||
      item.purchaseCost <= 0
    ) return null;
    total += line.quantity * item.purchaseCost;
  }

  const cost = total / composition.yieldQuantity;
  return Number.isFinite(cost) && cost >= 0 ? cost : null;
};

export const calculateSuggestedPrice = (
  unitCost: number | null,
  targetMarginPercent: number | null
): number | null => {
  if (
    unitCost === null ||
    targetMarginPercent === null ||
    !Number.isFinite(unitCost) ||
    !Number.isFinite(targetMarginPercent) ||
    unitCost < 0 ||
    targetMarginPercent < 0 ||
    targetMarginPercent >= 100
  ) return null;

  const price = unitCost / (1 - targetMarginPercent / 100);
  return Number.isFinite(price) ? price : null;
};

export const calculateSaleMarginPercent = (
  unitCost: number | null,
  salePrice: number | null
): number | null => {
  if (
    unitCost === null ||
    salePrice === null ||
    !Number.isFinite(unitCost) ||
    !Number.isFinite(salePrice) ||
    unitCost < 0 ||
    salePrice <= 0
  ) return null;
  return ((salePrice - unitCost) / salePrice) * 100;
};

export const roundCurrency = (value: number): number =>
  Math.round((value + Number.EPSILON) * 100) / 100;
