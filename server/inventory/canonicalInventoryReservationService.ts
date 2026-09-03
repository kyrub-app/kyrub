import { createHash } from 'node:crypto';
import { FieldValue } from 'firebase-admin/firestore';
import { adminDb } from '../firebaseAdmin';
import {
  buildInventoryReservationLines,
  type CommerceChannel,
  type InventoryReservationLine,
  type InventoryReservationStatus,
} from '../../shared/channelAvailabilityFiscalFoundation';
import {
  parseInventoryCatalogRecords,
  parseInventoryCompositionRecords,
} from '../../shared/inventoryConsumption';
import { resolveCanonicalInventoryAuthorityInTransaction } from './canonicalInventoryAuthorityService.js';

const clean = (value: unknown): string =>
  typeof value === 'string' ? value.trim() : '';

const roundQuantity = (value: number): number =>
  Math.round((value + Number.EPSILON) * 1_000_000) / 1_000_000;

const reservationsPath = (storeId: string): string =>
  `stores/${storeId}/inventoryReservations`;

const reservationIdFor = (
  storeId: string,
  orderId: string,
  sourceChannel: CommerceChannel
): string => `ires_${createHash('sha256')
  .update(`${storeId}:${sourceChannel}:${orderId}`)
  .digest('hex')
  .slice(0, 32)}`;

export interface CanonicalInventoryOrderLine {
  productId: string;
  quantity: number;
  transferredQuantity?: number;
}

export interface CanonicalInventoryReservationDocument {
  id: string;
  storeId: string;
  orderId: string;
  sourceChannel: CommerceChannel;
  inventoryAuthorityOwnerUserId: string;
  inventoryAuthority: 'active_store_owner_member';
  inventoryDocumentPath: string;
  status: InventoryReservationStatus;
  lines: InventoryReservationLine[];
  physicalConsumptionEvidenceId?: string;
}

export interface CanonicalInventoryAvailabilityLine {
  inventoryItemId: string;
  requiredQuantity: number;
  availableQuantity: number;
  shortageQuantity: number;
}

export interface CanonicalInventoryAvailabilityInspection {
  reservationId: string;
  state: 'ready' | 'insufficient_atp' | 'already_reserved' | 'not_applicable';
  lines: CanonicalInventoryAvailabilityLine[];
  checkedAt: string;
}

export class InventoryAvailableToPromiseExceededError extends Error {
  readonly code = 'INVENTORY_AVAILABLE_TO_PROMISE_EXCEEDED';

  constructor(
    readonly inventoryItemId: string,
    readonly requiredQuantity: number,
    readonly availableQuantity: number
  ) {
    super(
      `INVENTORY_AVAILABLE_TO_PROMISE_EXCEEDED:${inventoryItemId}:${requiredQuantity}:${availableQuantity}`
    );
    this.name = 'InventoryAvailableToPromiseExceededError';
  }
}

const aggregateLines = (lines: InventoryReservationLine[]): InventoryReservationLine[] => {
  const totals = new Map<string, number>();
  for (const line of lines) {
    if (!line.inventoryItemId || !Number.isFinite(line.quantity) || line.quantity <= 0) continue;
    totals.set(
      line.inventoryItemId,
      roundQuantity((totals.get(line.inventoryItemId) ?? 0) + line.quantity)
    );
  }
  return [...totals.entries()]
    .map(([inventoryItemId, quantity]) => ({ inventoryItemId, quantity }))
    .sort((left, right) => left.inventoryItemId.localeCompare(right.inventoryItemId));
};

const buildRequiredLines = (
  orderLines: CanonicalInventoryOrderLine[],
  compositions: ReturnType<typeof parseInventoryCompositionRecords>
): InventoryReservationLine[] => aggregateLines(orderLines.flatMap(orderLine => {
  const productId = clean(orderLine.productId);
  const quantity = Math.max(
    0,
    Math.trunc(orderLine.quantity) - Math.trunc(orderLine.transferredQuantity ?? 0)
  );
  if (!productId || quantity <= 0) return [];
  const composition = compositions[productId];
  if (!composition) return [];
  return buildInventoryReservationLines({
    productQuantity: quantity,
    composition,
  });
}));

type ActiveReservationSnapshot = {
  id: string;
  data: Partial<CanonicalInventoryReservationDocument>;
};

const evaluateAvailabilityLines = (input: {
  requiredLines: InventoryReservationLine[];
  catalog: ReturnType<typeof parseInventoryCatalogRecords>;
  activeReservations: ActiveReservationSnapshot[];
  excludedReservationId: string;
  inventoryAuthorityOwnerUserId: string;
}): CanonicalInventoryAvailabilityLine[] => {
  const activeTotals = new Map<string, number>();
  for (const reservation of input.activeReservations) {
    if (reservation.id === input.excludedReservationId) continue;
    const data = reservation.data;
    if (
      data.inventoryAuthorityOwnerUserId !== input.inventoryAuthorityOwnerUserId ||
      !Array.isArray(data.lines)
    ) continue;
    for (const line of data.lines) {
      if (!line?.inventoryItemId || !Number.isFinite(line.quantity) || line.quantity <= 0) continue;
      activeTotals.set(
        line.inventoryItemId,
        roundQuantity((activeTotals.get(line.inventoryItemId) ?? 0) + line.quantity)
      );
    }
  }

  const catalogById = new Map(input.catalog.map(item => [item.id, item]));
  return input.requiredLines.map(line => {
    const item = catalogById.get(line.inventoryItemId);
    if (!item) throw new Error(`INVENTORY_COMPONENT_NOT_FOUND:${line.inventoryItemId}`);
    const alreadyReserved = activeTotals.get(line.inventoryItemId) ?? 0;
    const availableQuantity = roundQuantity(
      Math.max(0, item.currentQuantity - alreadyReserved)
    );
    return {
      inventoryItemId: line.inventoryItemId,
      requiredQuantity: line.quantity,
      availableQuantity,
      shortageQuantity: roundQuantity(
        Math.max(0, line.quantity - availableQuantity)
      ),
    };
  });
};

export const inspectCanonicalOrderInventoryAvailability = async (input: {
  storeId: string;
  orderId: string;
  sourceChannel: CommerceChannel;
  orderLines: CanonicalInventoryOrderLine[];
}): Promise<CanonicalInventoryAvailabilityInspection> => {
  const storeId = clean(input.storeId);
  const orderId = clean(input.orderId);
  if (!storeId || !orderId) throw new Error('INVENTORY_RESERVATION_IDENTITY_REQUIRED');

  const reservationId = reservationIdFor(storeId, orderId, input.sourceChannel);
  const reservationReference = adminDb.doc(`${reservationsPath(storeId)}/${reservationId}`);
  const activeReservationsQuery = adminDb
    .collection(reservationsPath(storeId))
    .where('status', '==', 'active');

  return adminDb.runTransaction(async transaction => {
    const authority = await resolveCanonicalInventoryAuthorityInTransaction(
      transaction,
      storeId
    );
    const inventoryReference = adminDb.doc(authority.inventoryDocumentPath);
    const [inventorySnapshot, reservationSnapshot, activeReservationsSnapshot] = await Promise.all([
      transaction.get(inventoryReference),
      transaction.get(reservationReference),
      transaction.get(activeReservationsQuery),
    ]);

    if (!inventorySnapshot.exists) {
      throw new Error('INVENTORY_AUTHORITY_DOCUMENT_NOT_FOUND');
    }

    if (reservationSnapshot.exists) {
      const existing = reservationSnapshot.data() as CanonicalInventoryReservationDocument;
      if (
        existing.storeId === storeId &&
        existing.orderId === orderId &&
        existing.sourceChannel === input.sourceChannel &&
        existing.inventoryAuthorityOwnerUserId === authority.ownerUserId &&
        existing.status === 'active'
      ) {
        return {
          reservationId,
          state: 'already_reserved' as const,
          lines: (Array.isArray(existing.lines) ? existing.lines : []).map(line => ({
            inventoryItemId: line.inventoryItemId,
            requiredQuantity: line.quantity,
            availableQuantity: line.quantity,
            shortageQuantity: 0,
          })),
          checkedAt: new Date().toISOString(),
        };
      }
      throw new Error('INVENTORY_RESERVATION_ALREADY_TERMINAL_OR_CONFLICTING');
    }

    const inventoryData = inventorySnapshot.data();
    const catalog = parseInventoryCatalogRecords(
      inventoryData?.inventoryCatalog ?? inventoryData?.catalog
    );
    const compositions = parseInventoryCompositionRecords(
      inventoryData?.productCompositions ?? inventoryData?.compositions
    );
    const requiredLines = buildRequiredLines(input.orderLines, compositions);
    if (requiredLines.length === 0) {
      return {
        reservationId,
        state: 'not_applicable' as const,
        lines: [],
        checkedAt: new Date().toISOString(),
      };
    }

    const lines = evaluateAvailabilityLines({
      requiredLines,
      catalog,
      activeReservations: activeReservationsSnapshot.docs.map(document => ({
        id: document.id,
        data: document.data() as Partial<CanonicalInventoryReservationDocument>,
      })),
      excludedReservationId: reservationId,
      inventoryAuthorityOwnerUserId: authority.ownerUserId,
    });

    return {
      reservationId,
      state: lines.some(line => line.shortageQuantity > 0)
        ? 'insufficient_atp' as const
        : 'ready' as const,
      lines,
      checkedAt: new Date().toISOString(),
    };
  });
};

export const reserveCanonicalOrderInventory = async (input: {
  storeId: string;
  orderId: string;
  sourceChannel: CommerceChannel;
  orderLines: CanonicalInventoryOrderLine[];
}): Promise<{ reservationId: string; alreadyReserved: boolean; lines: InventoryReservationLine[] }> => {
  const storeId = clean(input.storeId);
  const orderId = clean(input.orderId);
  if (!storeId || !orderId) throw new Error('INVENTORY_RESERVATION_IDENTITY_REQUIRED');

  const reservationId = reservationIdFor(storeId, orderId, input.sourceChannel);
  const reservationReference = adminDb.doc(`${reservationsPath(storeId)}/${reservationId}`);
  const activeReservationsQuery = adminDb
    .collection(reservationsPath(storeId))
    .where('status', '==', 'active');

  return adminDb.runTransaction(async transaction => {
    const authority = await resolveCanonicalInventoryAuthorityInTransaction(
      transaction,
      storeId
    );
    const inventoryReference = adminDb.doc(authority.inventoryDocumentPath);
    const [inventorySnapshot, reservationSnapshot, activeReservationsSnapshot] = await Promise.all([
      transaction.get(inventoryReference),
      transaction.get(reservationReference),
      transaction.get(activeReservationsQuery),
    ]);

    if (!inventorySnapshot.exists) {
      throw new Error('INVENTORY_AUTHORITY_DOCUMENT_NOT_FOUND');
    }

    if (reservationSnapshot.exists) {
      const existing = reservationSnapshot.data() as CanonicalInventoryReservationDocument;
      if (
        existing.storeId === storeId &&
        existing.orderId === orderId &&
        existing.sourceChannel === input.sourceChannel &&
        existing.inventoryAuthorityOwnerUserId === authority.ownerUserId &&
        existing.status === 'active'
      ) {
        return {
          reservationId,
          alreadyReserved: true,
          lines: Array.isArray(existing.lines) ? existing.lines : [],
        };
      }
      throw new Error('INVENTORY_RESERVATION_ALREADY_TERMINAL_OR_CONFLICTING');
    }

    const inventoryData = inventorySnapshot.data();
    const catalog = parseInventoryCatalogRecords(
      inventoryData?.inventoryCatalog ?? inventoryData?.catalog
    );
    const compositions = parseInventoryCompositionRecords(
      inventoryData?.productCompositions ?? inventoryData?.compositions
    );
    const requiredLines = buildRequiredLines(input.orderLines, compositions);
    if (requiredLines.length === 0) {
      throw new Error('INVENTORY_RESERVATION_NO_COMPOSED_ITEMS');
    }

    const availabilityLines = evaluateAvailabilityLines({
      requiredLines,
      catalog,
      activeReservations: activeReservationsSnapshot.docs.map(document => ({
        id: document.id,
        data: document.data() as Partial<CanonicalInventoryReservationDocument>,
      })),
      excludedReservationId: reservationId,
      inventoryAuthorityOwnerUserId: authority.ownerUserId,
    });
    const shortage = availabilityLines.find(line => line.shortageQuantity > 0);
    if (shortage) {
      throw new InventoryAvailableToPromiseExceededError(
        shortage.inventoryItemId,
        shortage.requiredQuantity,
        shortage.availableQuantity
      );
    }

    transaction.create(reservationReference, {
      id: reservationId,
      storeId,
      orderId,
      sourceChannel: input.sourceChannel,
      inventoryAuthorityOwnerUserId: authority.ownerUserId,
      inventoryAuthority: authority.authority,
      inventoryDocumentPath: authority.inventoryDocumentPath,
      status: 'active',
      lines: requiredLines,
      authority: 'canonical_order_inventory_reservation',
      createdAt: FieldValue.serverTimestamp(),
      updatedAt: FieldValue.serverTimestamp(),
    });

    return { reservationId, alreadyReserved: false, lines: requiredLines };
  });
};

export const transitionCanonicalInventoryReservation = async (input: {
  storeId: string;
  reservationId: string;
  nextStatus: Exclude<InventoryReservationStatus, 'active'>;
  physicalConsumptionEvidenceId?: string;
}): Promise<{ alreadyTerminal: boolean; status: InventoryReservationStatus }> => {
  const storeId = clean(input.storeId);
  const reservationId = clean(input.reservationId);
  if (!storeId || !reservationId) throw new Error('INVENTORY_RESERVATION_IDENTITY_REQUIRED');
  const reference = adminDb.doc(`${reservationsPath(storeId)}/${reservationId}`);

  return adminDb.runTransaction(async transaction => {
    const snapshot = await transaction.get(reference);
    if (!snapshot.exists) throw new Error('INVENTORY_RESERVATION_NOT_FOUND');
    const data = snapshot.data() as CanonicalInventoryReservationDocument;
    if (data.storeId !== storeId || data.id !== reservationId) {
      throw new Error('INVENTORY_RESERVATION_IDENTITY_MISMATCH');
    }

    if (data.status !== 'active') {
      if (data.status === input.nextStatus) return { alreadyTerminal: true, status: data.status };
      throw new Error('INVENTORY_RESERVATION_TERMINAL_CONFLICT');
    }

    const evidenceId = clean(input.physicalConsumptionEvidenceId);
    if (input.nextStatus === 'consumed' && !evidenceId) {
      throw new Error('INVENTORY_PHYSICAL_CONSUMPTION_EVIDENCE_REQUIRED');
    }

    transaction.update(reference, {
      status: input.nextStatus,
      ...(input.nextStatus === 'consumed'
        ? { physicalConsumptionEvidenceId: evidenceId }
        : {}),
      terminalAt: FieldValue.serverTimestamp(),
      updatedAt: FieldValue.serverTimestamp(),
    });
    return { alreadyTerminal: false, status: input.nextStatus };
  });
};
