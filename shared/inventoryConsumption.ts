export type InventoryConsumptionTrigger = 'accepted' | 'preparing' | 'completed';

export type InventoryOrderStatus =
  | 'pending'
  | 'accepted'
  | 'preparing'
  | 'ready'
  | 'out_for_delivery'
  | 'completed'
  | 'rejected'
  | 'cancelled';

export interface InventoryCatalogRecord {
  id: string;
  name: string;
  unit: string;
  currentQuantity: number;
  minimumQuantity: number;
  purchaseCost: number;
  supplier: string;
  updatedAt: string;
}

export interface InventoryCompositionLineRecord {
  inventoryItemId: string;
  quantity: number;
}

export interface InventoryCompositionRecord {
  kind: 'recipe' | 'bundle';
  yieldQuantity: number;
  lines: InventoryCompositionLineRecord[];
  updatedAt: string;
}

export interface InventoryOrderItemRecord {
  productId: string;
  name: string;
  quantity: number;
  transferredQuantity?: number;
}

export interface InventoryConsumptionLine {
  inventoryItemId: string;
  inventoryItemName: string;
  unit: string;
  quantity: number;
  beforeQuantity: number;
  afterQuantity: number;
  productIds: string[];
}

const STATUS_RANK: Record<InventoryOrderStatus, number> = {
  pending: 0,
  accepted: 1,
  preparing: 2,
  ready: 3,
  out_for_delivery: 4,
  completed: 5,
  rejected: -1,
  cancelled: -1,
};

const clean = (value: unknown): string =>
  typeof value === 'string' ? value.trim() : '';

const finiteNonNegative = (value: unknown): number | null =>
  typeof value === 'number' && Number.isFinite(value) && value >= 0
    ? value
    : null;

const finitePositive = (value: unknown): number | null =>
  typeof value === 'number' && Number.isFinite(value) && value > 0
    ? value
    : null;

const roundQuantity = (value: number): number =>
  Math.round((value + Number.EPSILON) * 1_000_000) / 1_000_000;

export const parseInventoryConsumptionTrigger = (
  value: unknown
): InventoryConsumptionTrigger =>
  value === 'accepted' || value === 'completed' ? value : 'preparing';

export const shouldConsumeInventory = (
  trigger: InventoryConsumptionTrigger,
  status: InventoryOrderStatus
): boolean =>
  STATUS_RANK[status] >= STATUS_RANK[trigger];

export const isInventoryTerminalCancellation = (
  status: InventoryOrderStatus
): boolean => status === 'rejected' || status === 'cancelled';

export const parseInventoryCatalogRecords = (
  value: unknown
): InventoryCatalogRecord[] => {
  if (!Array.isArray(value)) return [];
  const seen = new Set<string>();
  return value.slice(0, 300).flatMap(candidate => {
    if (!candidate || typeof candidate !== 'object') return [];
    const record = candidate as Record<string, unknown>;
    const id = clean(record.id);
    const name = clean(record.name);
    const currentQuantity = finiteNonNegative(record.currentQuantity);
    const minimumQuantity = finiteNonNegative(record.minimumQuantity);
    const purchaseCost = finiteNonNegative(record.purchaseCost) ?? 0;
    if (
      !/^[a-zA-Z0-9_-]{1,128}$/.test(id) ||
      seen.has(id) ||
      !name ||
      currentQuantity === null ||
      minimumQuantity === null
    ) {
      return [];
    }
    seen.add(id);
    return [{
      id,
      name,
      unit: clean(record.unit) || 'un',
      currentQuantity,
      minimumQuantity,
      purchaseCost,
      supplier: clean(record.supplier),
      updatedAt: clean(record.updatedAt),
    } satisfies InventoryCatalogRecord];
  });
};

export const parseInventoryCompositionRecords = (
  value: unknown
): Record<string, InventoryCompositionRecord> => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
  const result: Record<string, InventoryCompositionRecord> = {};
  for (const [productId, candidate] of Object.entries(
    value as Record<string, unknown>
  )) {
    if (!/^[a-zA-Z0-9_-]{1,128}$/.test(productId)) continue;
    if (!candidate || typeof candidate !== 'object' || Array.isArray(candidate)) {
      continue;
    }
    const record = candidate as Record<string, unknown>;
    const yieldQuantity = finitePositive(record.yieldQuantity) ?? 1;
    const rawLines = Array.isArray(record.lines) ? record.lines : [];
    const lines = [...new Map(
      rawLines.slice(0, 40).flatMap(line => {
        if (!line || typeof line !== 'object') return [];
        const lineRecord = line as Record<string, unknown>;
        const inventoryItemId = clean(lineRecord.inventoryItemId);
        const quantity = finitePositive(lineRecord.quantity);
        if (!/^[a-zA-Z0-9_-]{1,128}$/.test(inventoryItemId) || quantity === null) {
          return [];
        }
        return [[inventoryItemId, { inventoryItemId, quantity }] as const];
      })
    ).values()];
    if (lines.length === 0) continue;
    result[productId] = {
      kind: record.kind === 'bundle' ? 'bundle' : 'recipe',
      yieldQuantity,
      lines,
      updatedAt: clean(record.updatedAt),
    };
  }
  return result;
};

export const buildOrderInventoryConsumption = (
  orderItems: InventoryOrderItemRecord[],
  catalog: InventoryCatalogRecord[],
  compositions: Record<string, InventoryCompositionRecord>
): InventoryConsumptionLine[] => {
  const catalogById = new Map(catalog.map(item => [item.id, item]));
  const totals = new Map<
    string,
    { quantity: number; productIds: Set<string> }
  >();

  for (const orderItem of orderItems) {
    const composition = compositions[clean(orderItem.productId)];
    if (!composition) continue;
    const operationalQuantity = Math.max(
      0,
      Math.trunc(orderItem.quantity) - Math.trunc(orderItem.transferredQuantity ?? 0)
    );
    if (operationalQuantity <= 0) continue;

    for (const line of composition.lines) {
      const required = roundQuantity(
        line.quantity * operationalQuantity / composition.yieldQuantity
      );
      const current = totals.get(line.inventoryItemId) ?? {
        quantity: 0,
        productIds: new Set<string>(),
      };
      current.quantity = roundQuantity(current.quantity + required);
      current.productIds.add(orderItem.productId);
      totals.set(line.inventoryItemId, current);
    }
  }

  return [...totals.entries()]
    .map(([inventoryItemId, total]) => {
      const item = catalogById.get(inventoryItemId);
      if (!item) {
        throw new Error(
          `A composição referencia um componente removido (${inventoryItemId}).`
        );
      }
      if (item.currentQuantity + 0.000001 < total.quantity) {
        throw new Error(
          `Estoque insuficiente de “${item.name}”: necessário ${total.quantity} ${item.unit}, disponível ${item.currentQuantity} ${item.unit}.`
        );
      }
      return {
        inventoryItemId,
        inventoryItemName: item.name,
        unit: item.unit,
        quantity: total.quantity,
        beforeQuantity: item.currentQuantity,
        afterQuantity: roundQuantity(item.currentQuantity - total.quantity),
        productIds: [...total.productIds].sort(),
      } satisfies InventoryConsumptionLine;
    })
    .sort((left, right) =>
      left.inventoryItemName.localeCompare(right.inventoryItemName, 'pt-BR')
    );
};

export const applyInventoryConsumptionLines = (
  catalog: InventoryCatalogRecord[],
  lines: InventoryConsumptionLine[],
  direction: 'consume' | 'restore'
): InventoryCatalogRecord[] => {
  const lineById = new Map(lines.map(line => [line.inventoryItemId, line]));
  return catalog.map(item => {
    const line = lineById.get(item.id);
    if (!line) return item;
    return {
      ...item,
      currentQuantity:
        direction === 'consume'
          ? line.afterQuantity
          : roundQuantity(item.currentQuantity + line.quantity),
      updatedAt: new Date().toISOString(),
    };
  });
};

export const calculateCompositionAvailableStock = (
  catalog: InventoryCatalogRecord[],
  composition: InventoryCompositionRecord | undefined
): number | null => {
  if (!composition?.lines.length) return null;
  const catalogById = new Map(catalog.map(item => [item.id, item]));
  let batches = Number.POSITIVE_INFINITY;
  for (const line of composition.lines) {
    const item = catalogById.get(line.inventoryItemId);
    if (!item) return 0;
    batches = Math.min(batches, Math.floor(item.currentQuantity / line.quantity));
  }
  return Number.isFinite(batches)
    ? Math.max(0, Math.floor(batches * composition.yieldQuantity))
    : 0;
};
