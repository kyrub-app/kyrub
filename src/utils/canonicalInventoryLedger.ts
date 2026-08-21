import type { StoreChannelId, StoreChannelRegistryEntry } from './channelRegistry';
import {
  getInventorySyncTargets,
  normalizeCanonicalInventoryChange,
  shouldApplyInboundInventoryToCanonical,
  type CanonicalInventoryChange,
  type InventorySyncTarget,
} from './omnichannelInventoryPolicy';

export type CanonicalInventoryMovementKind =
  | 'sale'
  | 'restock'
  | 'adjustment'
  | 'reconciliation'
  | 'external-sync';

export interface CanonicalInventoryLedgerEntry extends CanonicalInventoryChange {
  movementId: string;
  kind: CanonicalInventoryMovementKind;
  occurredAt: string;
  idempotencyKey: string;
}

export interface CanonicalInventoryPropagationPlan {
  entry: CanonicalInventoryLedgerEntry;
  targets: InventorySyncTarget[];
}

const required = (label: string, value: string): string => {
  const normalized = value.trim();
  if (!normalized) throw new Error(`${label} is required.`);
  return normalized;
};

export const buildCanonicalInventoryIdempotencyKey = (input: {
  storeId: string;
  productId: string;
  sourceChannel: StoreChannelId | 'internal';
  movementId: string;
}): string => [
  required('store id', input.storeId),
  required('product id', input.productId),
  input.sourceChannel,
  required('movement id', input.movementId),
].join(':');

export const buildCanonicalInventoryLedgerEntry = (input: {
  change: CanonicalInventoryChange;
  movementId: string;
  kind: CanonicalInventoryMovementKind;
  occurredAt?: string;
}): CanonicalInventoryLedgerEntry => {
  const change = normalizeCanonicalInventoryChange(input.change);
  const movementId = required('movement id', input.movementId);
  const occurredAt = (input.occurredAt || new Date().toISOString()).trim();
  if (!occurredAt || Number.isNaN(Date.parse(occurredAt))) {
    throw new Error('inventory movement occurredAt must be a valid ISO date.');
  }

  return {
    ...change,
    movementId,
    kind: input.kind,
    occurredAt,
    idempotencyKey: buildCanonicalInventoryIdempotencyKey({
      storeId: change.storeId,
      productId: change.productId,
      sourceChannel: change.sourceChannel,
      movementId,
    }),
  };
};

export const canApplyCanonicalInventoryEntry = (
  entry: CanonicalInventoryLedgerEntry,
  registry: StoreChannelRegistryEntry[]
): boolean =>
  entry.sourceChannel === 'internal' ||
  shouldApplyInboundInventoryToCanonical({
    sourceChannel: entry.sourceChannel,
    registry,
    storeId: entry.storeId,
  });

export const planCanonicalInventoryPropagation = (
  entry: CanonicalInventoryLedgerEntry,
  registry: StoreChannelRegistryEntry[]
): CanonicalInventoryPropagationPlan => {
  if (!canApplyCanonicalInventoryEntry(entry, registry)) {
    throw new Error('Inventory source channel is not enabled for canonical inventory sync.');
  }

  return {
    entry,
    targets: getInventorySyncTargets(registry, entry),
  };
};

export const isDuplicateCanonicalInventoryMovement = (
  entry: CanonicalInventoryLedgerEntry,
  processedIdempotencyKeys: ReadonlySet<string>
): boolean => processedIdempotencyKeys.has(entry.idempotencyKey);
