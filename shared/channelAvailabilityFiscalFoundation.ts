export type CommerceChannel = 'kyrub' | 'mercado_livre' | '99food' | 'other';

export type InventoryReservationStatus = 'active' | 'released' | 'consumed' | 'expired';

export interface AvailabilityInventoryItem {
  id: string;
  currentQuantity: number;
}

export interface AvailabilityCompositionLine {
  inventoryItemId: string;
  quantity: number;
}

export interface AvailabilityComposition {
  yieldQuantity: number;
  lines: AvailabilityCompositionLine[];
}

export interface InventoryReservationLine {
  inventoryItemId: string;
  quantity: number;
}

export interface InventoryReservation {
  id: string;
  storeId: string;
  orderId: string;
  sourceChannel: CommerceChannel;
  status: InventoryReservationStatus;
  lines: InventoryReservationLine[];
}

export interface ChannelAvailabilityPolicy {
  channel: CommerceChannel;
  enabled: boolean;
  safetyStockUnits: number;
  allocationCapUnits: number | null;
}

export interface AvailableToPromiseResult {
  physicalCompositionUnits: number;
  reservedComponentQuantities: Record<string, number>;
  availableComponentQuantities: Record<string, number>;
  availableToPromiseUnits: number;
}

export interface ChannelAvailabilityProjection extends AvailableToPromiseResult {
  channel: CommerceChannel;
  safetyStockUnits: number;
  allocationCapUnits: number | null;
  publishableUnits: number;
  authority: 'kyrub_inventory_and_reservation_projection';
}

const finiteNonNegative = (value: unknown): number | null =>
  typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : null;

const finitePositive = (value: unknown): number | null =>
  typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : null;

const roundQuantity = (value: number): number =>
  Math.round((value + Number.EPSILON) * 1_000_000) / 1_000_000;

const activeReservationTotals = (
  reservations: InventoryReservation[]
): Map<string, number> => {
  const totals = new Map<string, number>();
  for (const reservation of reservations) {
    if (reservation.status !== 'active') continue;
    for (const line of reservation.lines) {
      const quantity = finitePositive(line.quantity);
      if (!line.inventoryItemId || quantity === null) continue;
      totals.set(
        line.inventoryItemId,
        roundQuantity((totals.get(line.inventoryItemId) ?? 0) + quantity)
      );
    }
  }
  return totals;
};

export const buildInventoryReservationLines = (input: {
  productQuantity: number;
  composition: AvailabilityComposition;
}): InventoryReservationLine[] => {
  const productQuantity = Math.max(0, Math.trunc(input.productQuantity));
  const yieldQuantity = finitePositive(input.composition.yieldQuantity);
  if (productQuantity === 0 || yieldQuantity === null) return [];

  return input.composition.lines.flatMap(line => {
    const quantity = finitePositive(line.quantity);
    if (!line.inventoryItemId || quantity === null) return [];
    return [{
      inventoryItemId: line.inventoryItemId,
      quantity: roundQuantity(quantity * productQuantity / yieldQuantity),
    }];
  });
};

export const calculateAvailableToPromise = (input: {
  inventory: AvailabilityInventoryItem[];
  composition: AvailabilityComposition;
  reservations: InventoryReservation[];
}): AvailableToPromiseResult => {
  const yieldQuantity = finitePositive(input.composition.yieldQuantity);
  if (yieldQuantity === null || input.composition.lines.length === 0) {
    return {
      physicalCompositionUnits: 0,
      reservedComponentQuantities: {},
      availableComponentQuantities: {},
      availableToPromiseUnits: 0,
    };
  }

  const inventoryById = new Map(input.inventory.map(item => [item.id, item]));
  const reservedById = activeReservationTotals(input.reservations);
  const reservedComponentQuantities: Record<string, number> = {};
  const availableComponentQuantities: Record<string, number> = {};
  let physicalBatches = Number.POSITIVE_INFINITY;
  let promiseBatches = Number.POSITIVE_INFINITY;

  for (const line of input.composition.lines) {
    const perBatch = finitePositive(line.quantity);
    if (!line.inventoryItemId || perBatch === null) continue;
    const physical = finiteNonNegative(inventoryById.get(line.inventoryItemId)?.currentQuantity) ?? 0;
    const reserved = reservedById.get(line.inventoryItemId) ?? 0;
    const available = Math.max(0, roundQuantity(physical - reserved));
    reservedComponentQuantities[line.inventoryItemId] = reserved;
    availableComponentQuantities[line.inventoryItemId] = available;
    physicalBatches = Math.min(physicalBatches, Math.floor(physical / perBatch));
    promiseBatches = Math.min(promiseBatches, Math.floor(available / perBatch));
  }

  return {
    physicalCompositionUnits: Number.isFinite(physicalBatches)
      ? Math.max(0, Math.floor(physicalBatches * yieldQuantity))
      : 0,
    reservedComponentQuantities,
    availableComponentQuantities,
    availableToPromiseUnits: Number.isFinite(promiseBatches)
      ? Math.max(0, Math.floor(promiseBatches * yieldQuantity))
      : 0,
  };
};

export const projectChannelAvailability = (input: {
  inventory: AvailabilityInventoryItem[];
  composition: AvailabilityComposition;
  reservations: InventoryReservation[];
  policy: ChannelAvailabilityPolicy;
}): ChannelAvailabilityProjection => {
  const base = calculateAvailableToPromise(input);
  const safetyStockUnits = Math.max(0, Math.trunc(input.policy.safetyStockUnits));
  const cap = input.policy.allocationCapUnits === null
    ? null
    : Math.max(0, Math.trunc(input.policy.allocationCapUnits));
  const afterSafety = Math.max(0, base.availableToPromiseUnits - safetyStockUnits);
  const publishableUnits = input.policy.enabled
    ? (cap === null ? afterSafety : Math.min(afterSafety, cap))
    : 0;

  return {
    ...base,
    channel: input.policy.channel,
    safetyStockUnits,
    allocationCapUnits: cap,
    publishableUnits,
    authority: 'kyrub_inventory_and_reservation_projection',
  };
};

export type FiscalDocumentFamily =
  | 'goods_document_policy_required'
  | 'nfse'
  | 'mixed_operation_review_required';

export interface FiscalItemPreparation {
  productId: string;
  kind: 'goods' | 'service';
  fiscalProfileReady: boolean;
}

export interface FiscalEventCandidate {
  storeId: string;
  orderId: string;
  sourceChannel: CommerceChannel;
  trigger: 'commercially_confirmed';
  status:
    | 'not_triggered'
    | 'blocked_missing_fiscal_data'
    | 'ready_for_fiscal_policy';
  documentFamily: FiscalDocumentFamily | null;
  missingProductIds: string[];
  authority: 'canonical_order_and_fiscal_preparation';
}

export const evaluateFiscalEventCandidate = (input: {
  storeId: string;
  orderId: string;
  sourceChannel: CommerceChannel;
  commerciallyConfirmed: boolean;
  items: FiscalItemPreparation[];
}): FiscalEventCandidate => {
  const base = {
    storeId: input.storeId,
    orderId: input.orderId,
    sourceChannel: input.sourceChannel,
    trigger: 'commercially_confirmed' as const,
    authority: 'canonical_order_and_fiscal_preparation' as const,
  };

  if (!input.commerciallyConfirmed) {
    return {
      ...base,
      status: 'not_triggered',
      documentFamily: null,
      missingProductIds: [],
    };
  }

  const missingProductIds = input.items
    .filter(item => !item.fiscalProfileReady)
    .map(item => item.productId)
    .filter(Boolean)
    .sort();

  if (missingProductIds.length > 0 || input.items.length === 0) {
    return {
      ...base,
      status: 'blocked_missing_fiscal_data',
      documentFamily: null,
      missingProductIds,
    };
  }

  const hasGoods = input.items.some(item => item.kind === 'goods');
  const hasServices = input.items.some(item => item.kind === 'service');
  const documentFamily: FiscalDocumentFamily = hasGoods && hasServices
    ? 'mixed_operation_review_required'
    : hasServices
      ? 'nfse'
      : 'goods_document_policy_required';

  return {
    ...base,
    status: 'ready_for_fiscal_policy',
    documentFamily,
    missingProductIds: [],
  };
};
