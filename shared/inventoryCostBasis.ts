export type InventoryCostBasisStatus = 'complete' | 'incomplete';

export type InventoryCostBasisSource =
  | 'legacy_purchase_cost_seed'
  | 'purchase_receipt'
  | 'inventory_outflow'
  | 'inventory_restoration'
  | 'manual_adjustment'
  | 'unknown';

export interface InventoryCostBasisFields {
  costBasisStatus: InventoryCostBasisStatus;
  averageUnitCostMinor: number | null;
  lastPurchaseUnitCostMinor: number | null;
  inventoryValueMinor: number | null;
  costBasisSource: InventoryCostBasisSource;
  costBasisUpdatedAt: string;
}

export interface InventoryCostSnapshot {
  costBasisStatus: InventoryCostBasisStatus;
  unitCostMinor: number | null;
  totalCostMinor: number | null;
  inventoryValueBeforeMinor: number | null;
  inventoryValueAfterMinor: number | null;
  averageUnitCostBeforeMinor: number | null;
  averageUnitCostAfterMinor: number | null;
  lastPurchaseUnitCostMinor: number | null;
}

type CostableInventoryItem = {
  currentQuantity: number;
  purchaseCost: number;
  costBasisStatus?: InventoryCostBasisStatus;
  averageUnitCostMinor?: number | null;
  lastPurchaseUnitCostMinor?: number | null;
  inventoryValueMinor?: number | null;
  costBasisSource?: InventoryCostBasisSource;
  costBasisUpdatedAt?: string;
};

const QUANTITY_EPSILON = 0.000001;
const UNIT_COST_SCALE = 1_000_000;

const finiteNonNegative = (value: unknown): number | null =>
  typeof value === 'number' && Number.isFinite(value) && value >= 0
    ? value
    : null;

const finiteNonNegativeInteger = (value: unknown): number | null => {
  const numeric = finiteNonNegative(value);
  return numeric !== null && Number.isSafeInteger(numeric) ? numeric : null;
};

const roundUnitCost = (value: number): number =>
  Math.round((value + Number.EPSILON) * UNIT_COST_SCALE) / UNIT_COST_SCALE;

const normalizeSource = (value: unknown): InventoryCostBasisSource => {
  switch (value) {
    case 'legacy_purchase_cost_seed':
    case 'purchase_receipt':
    case 'inventory_outflow':
    case 'inventory_restoration':
    case 'manual_adjustment':
      return value;
    default:
      return 'unknown';
  }
};

const legacyPurchaseCostMinor = (purchaseCost: number): number | null => {
  if (!Number.isFinite(purchaseCost) || purchaseCost <= 0) return null;
  const value = Math.round(purchaseCost * 100);
  return Number.isSafeInteger(value) && value >= 0 ? value : null;
};

export const normalizeInventoryCostBasis = (
  item: CostableInventoryItem
): InventoryCostBasisFields => {
  const quantity = Math.max(0, item.currentQuantity);
  const explicitLastPurchase = finiteNonNegativeInteger(item.lastPurchaseUnitCostMinor);
  const fallbackLastPurchase = explicitLastPurchase ?? legacyPurchaseCostMinor(item.purchaseCost);
  const updatedAt = typeof item.costBasisUpdatedAt === 'string'
    ? item.costBasisUpdatedAt.trim()
    : '';

  if (item.costBasisStatus === 'incomplete') {
    return {
      costBasisStatus: 'incomplete',
      averageUnitCostMinor: null,
      lastPurchaseUnitCostMinor: fallbackLastPurchase,
      inventoryValueMinor: null,
      costBasisSource: normalizeSource(item.costBasisSource),
      costBasisUpdatedAt: updatedAt,
    };
  }

  if (item.costBasisStatus === 'complete') {
    const explicitValue = finiteNonNegativeInteger(item.inventoryValueMinor);
    const explicitAverage = finiteNonNegative(item.averageUnitCostMinor);
    if (quantity <= QUANTITY_EPSILON) {
      return {
        costBasisStatus: 'complete',
        averageUnitCostMinor: null,
        lastPurchaseUnitCostMinor: fallbackLastPurchase,
        inventoryValueMinor: 0,
        costBasisSource: normalizeSource(item.costBasisSource),
        costBasisUpdatedAt: updatedAt,
      };
    }
    if (explicitValue !== null) {
      return {
        costBasisStatus: 'complete',
        averageUnitCostMinor: roundUnitCost(
          explicitAverage ?? explicitValue / quantity
        ),
        lastPurchaseUnitCostMinor: fallbackLastPurchase,
        inventoryValueMinor: explicitValue,
        costBasisSource: normalizeSource(item.costBasisSource),
        costBasisUpdatedAt: updatedAt,
      };
    }
  }

  if (quantity <= QUANTITY_EPSILON) {
    return {
      costBasisStatus: 'complete',
      averageUnitCostMinor: null,
      lastPurchaseUnitCostMinor: fallbackLastPurchase,
      inventoryValueMinor: 0,
      costBasisSource: fallbackLastPurchase === null
        ? 'unknown'
        : 'legacy_purchase_cost_seed',
      costBasisUpdatedAt: updatedAt,
    };
  }

  const legacyUnitCostMinor = legacyPurchaseCostMinor(item.purchaseCost);
  if (legacyUnitCostMinor !== null) {
    return {
      costBasisStatus: 'complete',
      averageUnitCostMinor: legacyUnitCostMinor,
      lastPurchaseUnitCostMinor: fallbackLastPurchase,
      inventoryValueMinor: Math.round(quantity * legacyUnitCostMinor),
      costBasisSource: 'legacy_purchase_cost_seed',
      costBasisUpdatedAt: updatedAt,
    };
  }

  return {
    costBasisStatus: 'incomplete',
    averageUnitCostMinor: null,
    lastPurchaseUnitCostMinor: fallbackLastPurchase,
    inventoryValueMinor: null,
    costBasisSource: 'unknown',
    costBasisUpdatedAt: updatedAt,
  };
};

const withCostBasis = <T extends CostableInventoryItem>(
  item: T,
  fields: InventoryCostBasisFields,
  purchaseCost?: number
): T & InventoryCostBasisFields => ({
  ...item,
  ...(purchaseCost === undefined ? {} : { purchaseCost }),
  ...fields,
});

export const applyMovingAverageInventoryIntake = <T extends CostableInventoryItem>(
  item: T,
  input: {
    quantity: number;
    resultingQuantity: number;
    unitCostMinor: number | null;
    now?: string;
    source?: Extract<InventoryCostBasisSource, 'purchase_receipt' | 'manual_adjustment'>;
  }
): { item: T & InventoryCostBasisFields; snapshot: InventoryCostSnapshot } => {
  const before = normalizeInventoryCostBasis(item);
  const now = input.now ?? new Date().toISOString();
  const quantity = Math.max(0, input.quantity);
  const resultingQuantity = Math.max(0, input.resultingQuantity);
  const unitCostMinor = finiteNonNegativeInteger(input.unitCostMinor);
  const intakeTotalMinor = unitCostMinor === null
    ? null
    : Math.round(quantity * unitCostMinor);
  const canValue = unitCostMinor !== null
    && intakeTotalMinor !== null
    && (item.currentQuantity <= QUANTITY_EPSILON || before.costBasisStatus === 'complete')
    && (item.currentQuantity <= QUANTITY_EPSILON || before.inventoryValueMinor !== null);

  if (!canValue) {
    const nextFields: InventoryCostBasisFields = {
      costBasisStatus: 'incomplete',
      averageUnitCostMinor: null,
      lastPurchaseUnitCostMinor: unitCostMinor ?? before.lastPurchaseUnitCostMinor,
      inventoryValueMinor: null,
      costBasisSource: input.source ?? 'purchase_receipt',
      costBasisUpdatedAt: now,
    };
    return {
      item: withCostBasis(
        item,
        nextFields,
        unitCostMinor === null ? undefined : unitCostMinor / 100
      ),
      snapshot: {
        costBasisStatus: 'incomplete',
        unitCostMinor,
        totalCostMinor: intakeTotalMinor,
        inventoryValueBeforeMinor: before.inventoryValueMinor,
        inventoryValueAfterMinor: null,
        averageUnitCostBeforeMinor: before.averageUnitCostMinor,
        averageUnitCostAfterMinor: null,
        lastPurchaseUnitCostMinor: nextFields.lastPurchaseUnitCostMinor,
      },
    };
  }

  const previousValueMinor = item.currentQuantity <= QUANTITY_EPSILON
    ? 0
    : before.inventoryValueMinor ?? 0;
  const inventoryValueMinor = previousValueMinor + intakeTotalMinor;
  const averageUnitCostMinor = resultingQuantity <= QUANTITY_EPSILON
    ? null
    : roundUnitCost(inventoryValueMinor / resultingQuantity);
  const nextFields: InventoryCostBasisFields = {
    costBasisStatus: 'complete',
    averageUnitCostMinor,
    lastPurchaseUnitCostMinor: unitCostMinor,
    inventoryValueMinor,
    costBasisSource: input.source ?? 'purchase_receipt',
    costBasisUpdatedAt: now,
  };
  return {
    item: withCostBasis(item, nextFields, unitCostMinor / 100),
    snapshot: {
      costBasisStatus: 'complete',
      unitCostMinor,
      totalCostMinor: intakeTotalMinor,
      inventoryValueBeforeMinor: previousValueMinor,
      inventoryValueAfterMinor: inventoryValueMinor,
      averageUnitCostBeforeMinor: before.averageUnitCostMinor,
      averageUnitCostAfterMinor,
      lastPurchaseUnitCostMinor: unitCostMinor,
    },
  };
};

export const applyMovingAverageInventoryOutflow = <T extends CostableInventoryItem>(
  item: T,
  input: {
    quantity: number;
    resultingQuantity: number;
    now?: string;
  }
): { item: T & InventoryCostBasisFields; snapshot: InventoryCostSnapshot } => {
  const before = normalizeInventoryCostBasis(item);
  const now = input.now ?? new Date().toISOString();
  const quantity = Math.max(0, input.quantity);
  const resultingQuantity = Math.max(0, input.resultingQuantity);

  if (
    before.costBasisStatus !== 'complete'
    || before.inventoryValueMinor === null
    || before.averageUnitCostMinor === null
  ) {
    const nextFields: InventoryCostBasisFields = {
      ...before,
      costBasisStatus: resultingQuantity <= QUANTITY_EPSILON ? 'complete' : 'incomplete',
      averageUnitCostMinor: null,
      inventoryValueMinor: resultingQuantity <= QUANTITY_EPSILON ? 0 : null,
      costBasisSource: 'inventory_outflow',
      costBasisUpdatedAt: now,
    };
    return {
      item: withCostBasis(item, nextFields),
      snapshot: {
        costBasisStatus: nextFields.costBasisStatus,
        unitCostMinor: null,
        totalCostMinor: null,
        inventoryValueBeforeMinor: before.inventoryValueMinor,
        inventoryValueAfterMinor: nextFields.inventoryValueMinor,
        averageUnitCostBeforeMinor: before.averageUnitCostMinor,
        averageUnitCostAfterMinor: nextFields.averageUnitCostMinor,
        lastPurchaseUnitCostMinor: nextFields.lastPurchaseUnitCostMinor,
      },
    };
  }

  const totalCostMinor = Math.min(
    before.inventoryValueMinor,
    Math.max(0, Math.round(quantity * before.averageUnitCostMinor))
  );
  const inventoryValueMinor = resultingQuantity <= QUANTITY_EPSILON
    ? 0
    : Math.max(0, before.inventoryValueMinor - totalCostMinor);
  const averageUnitCostMinor = resultingQuantity <= QUANTITY_EPSILON
    ? null
    : roundUnitCost(inventoryValueMinor / resultingQuantity);
  const nextFields: InventoryCostBasisFields = {
    costBasisStatus: 'complete',
    averageUnitCostMinor,
    lastPurchaseUnitCostMinor: before.lastPurchaseUnitCostMinor,
    inventoryValueMinor,
    costBasisSource: 'inventory_outflow',
    costBasisUpdatedAt: now,
  };
  return {
    item: withCostBasis(item, nextFields),
    snapshot: {
      costBasisStatus: 'complete',
      unitCostMinor: before.averageUnitCostMinor,
      totalCostMinor,
      inventoryValueBeforeMinor: before.inventoryValueMinor,
      inventoryValueAfterMinor: inventoryValueMinor,
      averageUnitCostBeforeMinor: before.averageUnitCostMinor,
      averageUnitCostAfterMinor,
      lastPurchaseUnitCostMinor: before.lastPurchaseUnitCostMinor,
    },
  };
};

export const restoreInventoryAtHistoricalCost = <T extends CostableInventoryItem>(
  item: T,
  input: {
    quantity: number;
    resultingQuantity: number;
    historicalUnitCostMinor: number | null | undefined;
    historicalTotalCostMinor: number | null | undefined;
    now?: string;
  }
): { item: T & InventoryCostBasisFields; snapshot: InventoryCostSnapshot } => {
  const before = normalizeInventoryCostBasis(item);
  const now = input.now ?? new Date().toISOString();
  const resultingQuantity = Math.max(0, input.resultingQuantity);
  const historicalUnitCostMinor = finiteNonNegative(input.historicalUnitCostMinor);
  const historicalTotalCostMinor = finiteNonNegativeInteger(input.historicalTotalCostMinor);
  const currentValueKnown = item.currentQuantity <= QUANTITY_EPSILON
    || (before.costBasisStatus === 'complete' && before.inventoryValueMinor !== null);

  if (
    !currentValueKnown
    || historicalUnitCostMinor === null
    || historicalTotalCostMinor === null
  ) {
    const nextFields: InventoryCostBasisFields = {
      costBasisStatus: 'incomplete',
      averageUnitCostMinor: null,
      lastPurchaseUnitCostMinor: before.lastPurchaseUnitCostMinor,
      inventoryValueMinor: null,
      costBasisSource: 'inventory_restoration',
      costBasisUpdatedAt: now,
    };
    return {
      item: withCostBasis(item, nextFields),
      snapshot: {
        costBasisStatus: 'incomplete',
        unitCostMinor: historicalUnitCostMinor,
        totalCostMinor: historicalTotalCostMinor,
        inventoryValueBeforeMinor: before.inventoryValueMinor,
        inventoryValueAfterMinor: null,
        averageUnitCostBeforeMinor: before.averageUnitCostMinor,
        averageUnitCostAfterMinor: null,
        lastPurchaseUnitCostMinor: before.lastPurchaseUnitCostMinor,
      },
    };
  }

  const previousValueMinor = item.currentQuantity <= QUANTITY_EPSILON
    ? 0
    : before.inventoryValueMinor ?? 0;
  const inventoryValueMinor = previousValueMinor + historicalTotalCostMinor;
  const averageUnitCostMinor = resultingQuantity <= QUANTITY_EPSILON
    ? null
    : roundUnitCost(inventoryValueMinor / resultingQuantity);
  const nextFields: InventoryCostBasisFields = {
    costBasisStatus: 'complete',
    averageUnitCostMinor,
    lastPurchaseUnitCostMinor: before.lastPurchaseUnitCostMinor,
    inventoryValueMinor,
    costBasisSource: 'inventory_restoration',
    costBasisUpdatedAt: now,
  };
  return {
    item: withCostBasis(item, nextFields),
    snapshot: {
      costBasisStatus: 'complete',
      unitCostMinor: historicalUnitCostMinor,
      totalCostMinor: historicalTotalCostMinor,
      inventoryValueBeforeMinor: previousValueMinor,
      inventoryValueAfterMinor: inventoryValueMinor,
      averageUnitCostBeforeMinor: before.averageUnitCostMinor,
      averageUnitCostAfterMinor,
      lastPurchaseUnitCostMinor: before.lastPurchaseUnitCostMinor,
    },
  };
};
