import { createHash } from 'node:crypto';
import {
  FieldValue,
  type DocumentData,
  type DocumentReference,
  type Transaction,
} from 'firebase-admin/firestore';
import type { InventoryCatalogRecord } from '../../shared/inventoryConsumption.js';

const MAX_RECENT_MOVEMENTS = 20;
const MAX_RECENT_MOVEMENT_LINES = 12;
const QUANTITY_SCALE = 1_000_000;

export type OrderInventoryMovementReason =
  | 'order_sale'
  | 'order_cancellation'
  | 'order_adjustment';

type OrderInventoryMovementLine = {
  itemId: string;
  name: string;
  unit: string;
  quantityDelta: number;
  previousQuantity: number;
  resultingQuantity: number;
  purchaseCost?: number;
};

type OrderInventoryMovement = {
  id: string;
  kind: 'intake' | 'outflow';
  mode: 'increment' | 'decrement';
  sourceKind: 'inventory_intake_text' | 'manual_outflow';
  sourceLabel: string;
  entryCount: number;
  createdAt: string;
  lines: OrderInventoryMovementLine[];
  linesTruncated: boolean;
};

const roundQuantity = (value: number): number =>
  Math.round((value + Number.EPSILON) * QUANTITY_SCALE) / QUANTITY_SCALE;

const finiteRevision = (value: unknown): number =>
  typeof value === 'number' && Number.isInteger(value) && value >= 0
    ? value
    : 0;

export const currentOrderInventoryMovementRevision = (
  ledgerData: DocumentData | Record<string, unknown> | undefined
): number => finiteRevision(ledgerData?.inventoryMovementRevision);

export const nextOrderInventoryMovementRevision = (
  ledgerData: DocumentData | Record<string, unknown> | undefined
): number => currentOrderInventoryMovementRevision(ledgerData) + 1;

const movementIdFor = (input: {
  ownerUserId: string;
  tenantId: string;
  orderId: string;
  revision: number;
  reason: OrderInventoryMovementReason;
  kind: 'intake' | 'outflow';
}): string =>
  `movement-${createHash('sha256')
    .update([
      input.ownerUserId,
      input.tenantId,
      input.orderId,
      String(input.revision),
      input.reason,
      input.kind,
    ].join(':'))
    .digest('hex')
    .slice(0, 40)}`;

const labelFor = (
  reason: OrderInventoryMovementReason,
  orderId: string
): string => {
  if (reason === 'order_sale') return `Venda · Pedido ${orderId}`;
  if (reason === 'order_cancellation') return `Cancelamento · Pedido ${orderId}`;
  return `Ajuste do pedido ${orderId}`;
};

export const buildOrderInventoryMovementLines = (
  previousCatalog: InventoryCatalogRecord[],
  resultingCatalog: InventoryCatalogRecord[]
): OrderInventoryMovementLine[] => {
  const previousById = new Map(previousCatalog.map(item => [item.id, item]));
  const resultingById = new Map(resultingCatalog.map(item => [item.id, item]));
  const ids = new Set([...previousById.keys(), ...resultingById.keys()]);
  const lines: OrderInventoryMovementLine[] = [];

  for (const itemId of ids) {
    const previous = previousById.get(itemId);
    const resulting = resultingById.get(itemId);
    if (!previous || !resulting) continue;
    const previousQuantity = roundQuantity(previous.currentQuantity);
    const resultingQuantity = roundQuantity(resulting.currentQuantity);
    const quantityDelta = roundQuantity(resultingQuantity - previousQuantity);
    if (Math.abs(quantityDelta) < 1 / QUANTITY_SCALE) continue;
    lines.push({
      itemId,
      name: resulting.name || previous.name,
      unit: resulting.unit || previous.unit,
      quantityDelta,
      previousQuantity,
      resultingQuantity,
      ...(Number.isFinite(resulting.purchaseCost)
        ? { purchaseCost: resulting.purchaseCost }
        : {}),
    });
  }

  return lines.sort((left, right) =>
    left.name.localeCompare(right.name, 'pt-BR')
  );
};

const recentMovementsFrom = (inventoryData: DocumentData | undefined): Record<string, unknown>[] =>
  Array.isArray(inventoryData?.recentInventoryMovements)
    ? inventoryData.recentInventoryMovements.filter(
        (value: unknown): value is Record<string, unknown> =>
          Boolean(value) && typeof value === 'object' && !Array.isArray(value)
      )
    : [];

export const appendOrderInventoryMovementsInTransaction = (input: {
  transaction: Transaction;
  inventoryReference: DocumentReference;
  inventoryData: DocumentData | undefined;
  ownerUserId: string;
  tenantId: string;
  orderId: string;
  revision: number;
  reason: OrderInventoryMovementReason;
  previousCatalog: InventoryCatalogRecord[];
  resultingCatalog: InventoryCatalogRecord[];
}): string[] => {
  const lines = buildOrderInventoryMovementLines(
    input.previousCatalog,
    input.resultingCatalog
  );
  const grouped = [
    {
      kind: 'outflow' as const,
      mode: 'decrement' as const,
      sourceKind: 'manual_outflow' as const,
      lines: lines.filter(line => line.quantityDelta < 0),
    },
    {
      kind: 'intake' as const,
      mode: 'increment' as const,
      sourceKind: 'inventory_intake_text' as const,
      lines: lines.filter(line => line.quantityDelta > 0),
    },
  ].filter(group => group.lines.length > 0);

  if (grouped.length === 0) return [];

  const now = new Date().toISOString();
  const sourceLabel = labelFor(input.reason, input.orderId);
  const newRecentMovements: OrderInventoryMovement[] = [];
  const movementIds: string[] = [];

  for (const group of grouped) {
    const movementId = movementIdFor({
      ownerUserId: input.ownerUserId,
      tenantId: input.tenantId,
      orderId: input.orderId,
      revision: input.revision,
      reason: input.reason,
      kind: group.kind,
    });
    movementIds.push(movementId);
    const movement: OrderInventoryMovement = {
      id: movementId,
      kind: group.kind,
      mode: group.mode,
      sourceKind: group.sourceKind,
      sourceLabel,
      entryCount: group.lines.length,
      createdAt: now,
      lines: group.lines.slice(0, MAX_RECENT_MOVEMENT_LINES),
      linesTruncated: group.lines.length > MAX_RECENT_MOVEMENT_LINES,
    };
    newRecentMovements.push(movement);

    input.transaction.set(
      input.inventoryReference.collection('movements').doc(movementId),
      {
        schemaVersion: 1,
        id: movementId,
        ownerId: input.ownerUserId,
        actionType: 'order_inventory',
        mode: group.mode,
        kind: group.kind,
        reason: input.reason,
        sourceKind: group.sourceKind,
        sourceLabel,
        origin: 'automation',
        tenantId: input.tenantId,
        orderId: input.orderId,
        orderInventoryRevision: input.revision,
        lines: group.lines,
        entryCount: group.lines.length,
        createdAt: FieldValue.serverTimestamp(),
      },
      { merge: false }
    );
  }

  const newIds = new Set(movementIds);
  const nextRecentMovements = [
    ...newRecentMovements,
    ...recentMovementsFrom(input.inventoryData).filter(
      movement => typeof movement.id !== 'string' || !newIds.has(movement.id)
    ),
  ].slice(0, MAX_RECENT_MOVEMENTS);
  const lastMovement = {
    id: movementIds[0],
    movementId: movementIds[0],
    kind: newRecentMovements[0].kind,
    sourceKind: newRecentMovements[0].sourceKind,
    sourceLabel,
    entryCount: lines.length,
    orderId: input.orderId,
    orderInventoryRevision: input.revision,
    confirmedAt: FieldValue.serverTimestamp(),
  };
  const inventoryPatch: Record<string, unknown> = {
    recentInventoryMovements: nextRecentMovements,
    recentInventoryMovementCount: nextRecentMovements.length,
    lastInventoryMovement: lastMovement,
    updatedAt: FieldValue.serverTimestamp(),
  };
  const intake = newRecentMovements.find(movement => movement.kind === 'intake');
  if (intake) {
    inventoryPatch.lastInventoryIntake = {
      ...lastMovement,
      id: intake.id,
      movementId: intake.id,
      kind: intake.kind,
      sourceKind: intake.sourceKind,
    };
  }

  input.transaction.set(input.inventoryReference, inventoryPatch, { merge: true });
  return movementIds;
};
