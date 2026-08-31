import { createHash } from 'node:crypto';
import { FieldValue } from 'firebase-admin/firestore';
import { adminDb } from '../firebaseAdmin.js';
import {
  projectChannelAvailability,
  type ChannelAvailabilityPolicy,
  type CommerceChannel,
  type InventoryReservation,
} from '../../shared/channelAvailabilityFiscalFoundation.js';
import {
  parseInventoryCatalogRecords,
  parseInventoryCompositionRecords,
} from '../../shared/inventoryConsumption.js';
import { resolveCanonicalInventoryAuthorityInTransaction } from './canonicalInventoryAuthorityService.js';

const PERSISTED_CHANNELS = new Set<CommerceChannel>(['kyrub', 'mercado_livre', '99food']);

const clean = (value: unknown): string =>
  typeof value === 'string' ? value.trim() : '';

const safeId = (value: string): string =>
  value.trim().replace(/[^a-zA-Z0-9_-]/g, '_');

const nonNegativeInteger = (value: unknown): number | null =>
  typeof value === 'number' && Number.isSafeInteger(value) && value >= 0
    ? value
    : null;

const stableValue = (value: unknown): unknown => {
  if (Array.isArray(value)) return value.map(stableValue);
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, nested]) => [key, stableValue(nested)])
    );
  }
  return value;
};

const hashValue = (value: unknown): string =>
  createHash('sha256').update(JSON.stringify(stableValue(value))).digest('hex');

const policyPath = (storeId: string, channel: CommerceChannel): string =>
  `stores/${storeId}/channelAvailabilityPolicies/${channel}`;

const snapshotsPath = (storeId: string): string =>
  `stores/${storeId}/channelAvailabilitySnapshots`;

const currentPath = (
  storeId: string,
  channel: CommerceChannel,
  productId: string
): string =>
  `stores/${storeId}/channelAvailabilityCurrent/${channel}__${safeId(productId)}`;

const parseChannel = (value: unknown): CommerceChannel => {
  const channel = clean(value) as CommerceChannel;
  if (!PERSISTED_CHANNELS.has(channel)) {
    throw new Error('CHANNEL_AVAILABILITY_CHANNEL_UNSUPPORTED');
  }
  return channel;
};

const parsePolicy = (
  channel: CommerceChannel,
  value: Record<string, unknown> | undefined
): ChannelAvailabilityPolicy => {
  if (!value) throw new Error('CHANNEL_AVAILABILITY_POLICY_REQUIRED');
  const safetyStockUnits = nonNegativeInteger(value.safetyStockUnits);
  const rawCap = value.allocationCapUnits;
  const allocationCapUnits = rawCap === null
    ? null
    : nonNegativeInteger(rawCap);
  if (
    typeof value.enabled !== 'boolean' ||
    safetyStockUnits === null ||
    (rawCap !== null && allocationCapUnits === null)
  ) {
    throw new Error('CHANNEL_AVAILABILITY_POLICY_INVALID');
  }
  return {
    channel,
    enabled: value.enabled,
    safetyStockUnits,
    allocationCapUnits,
  };
};

export interface PersistedChannelAvailabilityPolicy extends ChannelAvailabilityPolicy {
  storeId: string;
  authority: 'store_owner_channel_availability_policy';
  configuredByUserId: string;
  revision: number;
}

export const setChannelAvailabilityPolicy = async (input: {
  storeId: string;
  channel: CommerceChannel;
  enabled: boolean;
  safetyStockUnits: number;
  allocationCapUnits: number | null;
  configuredByUserId: string;
}): Promise<PersistedChannelAvailabilityPolicy> => {
  const storeId = clean(input.storeId);
  const configuredByUserId = clean(input.configuredByUserId);
  const channel = parseChannel(input.channel);
  if (!storeId || !configuredByUserId) {
    throw new Error('CHANNEL_AVAILABILITY_POLICY_IDENTITY_REQUIRED');
  }
  const policy = parsePolicy(channel, {
    enabled: input.enabled,
    safetyStockUnits: input.safetyStockUnits,
    allocationCapUnits: input.allocationCapUnits,
  });
  const reference = adminDb.doc(policyPath(storeId, channel));

  return adminDb.runTransaction(async transaction => {
    const authority = await resolveCanonicalInventoryAuthorityInTransaction(
      transaction,
      storeId
    );
    if (authority.ownerUserId !== configuredByUserId) {
      throw new Error('CHANNEL_AVAILABILITY_POLICY_OWNER_REQUIRED');
    }
    const existing = await transaction.get(reference);
    const revision = Math.max(0, Number(existing.data()?.revision ?? 0)) + 1;
    const document: PersistedChannelAvailabilityPolicy = {
      storeId,
      ...policy,
      authority: 'store_owner_channel_availability_policy',
      configuredByUserId,
      revision,
    };
    transaction.set(reference, {
      ...document,
      createdAt: existing.exists
        ? existing.data()?.createdAt ?? FieldValue.serverTimestamp()
        : FieldValue.serverTimestamp(),
      updatedAt: FieldValue.serverTimestamp(),
    });
    return document;
  });
};

const parseActiveReservations = (
  storeId: string,
  ownerUserId: string,
  documents: Array<{ id: string; data(): Record<string, unknown> }>
): InventoryReservation[] => documents.flatMap(document => {
  const data = document.data();
  if (
    clean(data.storeId) !== storeId ||
    clean(data.inventoryAuthorityOwnerUserId) !== ownerUserId ||
    clean(data.status) !== 'active' ||
    !Array.isArray(data.lines)
  ) return [];
  const sourceChannel = clean(data.sourceChannel) as CommerceChannel;
  if (!PERSISTED_CHANNELS.has(sourceChannel) && sourceChannel !== 'other') return [];
  return [{
    id: document.id,
    storeId,
    orderId: clean(data.orderId),
    sourceChannel,
    status: 'active',
    lines: data.lines.flatMap(candidate => {
      if (!candidate || typeof candidate !== 'object' || Array.isArray(candidate)) return [];
      const line = candidate as Record<string, unknown>;
      const inventoryItemId = clean(line.inventoryItemId);
      const quantity = typeof line.quantity === 'number' && Number.isFinite(line.quantity)
        ? line.quantity
        : 0;
      return inventoryItemId && quantity > 0
        ? [{ inventoryItemId, quantity }]
        : [];
    }),
  }];
});

export interface ChannelAvailabilitySnapshotResult {
  snapshotId: string;
  storeId: string;
  productId: string;
  channel: CommerceChannel;
  physicalCompositionUnits: number;
  availableToPromiseUnits: number;
  publishableUnits: number;
  policyRevision: number;
  sourceFingerprint: string;
  alreadyExisted: boolean;
}

export const createChannelAvailabilitySnapshot = async (input: {
  storeId: string;
  productId: string;
  channel: CommerceChannel;
  requestedByUserId: string;
}): Promise<ChannelAvailabilitySnapshotResult> => {
  const storeId = clean(input.storeId);
  const productId = clean(input.productId);
  const requestedByUserId = clean(input.requestedByUserId);
  const channel = parseChannel(input.channel);
  if (!storeId || !productId || !requestedByUserId) {
    throw new Error('CHANNEL_AVAILABILITY_SNAPSHOT_IDENTITY_REQUIRED');
  }

  return adminDb.runTransaction(async transaction => {
    const authority = await resolveCanonicalInventoryAuthorityInTransaction(
      transaction,
      storeId
    );
    if (authority.ownerUserId !== requestedByUserId) {
      throw new Error('CHANNEL_AVAILABILITY_SNAPSHOT_OWNER_REQUIRED');
    }

    const inventoryReference = adminDb.doc(authority.inventoryDocumentPath);
    const policyReference = adminDb.doc(policyPath(storeId, channel));
    const reservationsQuery = adminDb
      .collection(`stores/${storeId}/inventoryReservations`)
      .where('status', '==', 'active');
    const [inventorySnapshot, policySnapshot, reservationSnapshot] = await Promise.all([
      transaction.get(inventoryReference),
      transaction.get(policyReference),
      transaction.get(reservationsQuery),
    ]);
    if (!inventorySnapshot.exists) {
      throw new Error('INVENTORY_AUTHORITY_DOCUMENT_NOT_FOUND');
    }
    const policyData = policySnapshot.data() as Record<string, unknown> | undefined;
    const policy = parsePolicy(channel, policyData);
    if (
      clean(policyData?.authority) !== 'store_owner_channel_availability_policy' ||
      clean(policyData?.storeId) !== storeId
    ) {
      throw new Error('CHANNEL_AVAILABILITY_POLICY_AUTHORITY_INVALID');
    }
    const policyRevision = nonNegativeInteger(policyData?.revision);
    if (policyRevision === null || policyRevision < 1) {
      throw new Error('CHANNEL_AVAILABILITY_POLICY_REVISION_INVALID');
    }

    const inventoryData = inventorySnapshot.data();
    const inventory = parseInventoryCatalogRecords(
      inventoryData?.inventoryCatalog ?? inventoryData?.catalog
    );
    const compositions = parseInventoryCompositionRecords(
      inventoryData?.productCompositions ?? inventoryData?.compositions
    );
    const composition = compositions[productId];
    if (!composition) {
      throw new Error('CHANNEL_AVAILABILITY_PRODUCT_COMPOSITION_REQUIRED');
    }
    const reservations = parseActiveReservations(
      storeId,
      authority.ownerUserId,
      reservationSnapshot.docs as Array<{ id: string; data(): Record<string, unknown> }>
    );
    const projection = projectChannelAvailability({
      inventory,
      composition,
      reservations,
      policy,
    });

    const source = {
      storeId,
      productId,
      channel,
      inventoryAuthorityOwnerUserId: authority.ownerUserId,
      inventoryDocumentPath: authority.inventoryDocumentPath,
      inventory: inventory.map(item => ({ id: item.id, currentQuantity: item.currentQuantity })),
      composition,
      activeReservations: reservations
        .map(reservation => ({
          id: reservation.id,
          orderId: reservation.orderId,
          sourceChannel: reservation.sourceChannel,
          lines: reservation.lines,
        }))
        .sort((left, right) => left.id.localeCompare(right.id)),
      policy: { ...policy, revision: policyRevision },
    };
    const sourceFingerprint = hashValue(source);
    const snapshotId = `cavs_${sourceFingerprint.slice(0, 40)}`;
    const snapshotReference = adminDb.doc(`${snapshotsPath(storeId)}/${snapshotId}`);
    const currentReference = adminDb.doc(currentPath(storeId, channel, productId));
    const existingSnapshot = await transaction.get(snapshotReference);

    if (!existingSnapshot.exists) {
      transaction.create(snapshotReference, {
        snapshotId,
        storeId,
        productId,
        channel,
        authority: 'kyrub_inventory_reservation_policy_snapshot',
        inventoryAuthorityOwnerUserId: authority.ownerUserId,
        inventoryAuthority: authority.authority,
        inventoryDocumentPath: authority.inventoryDocumentPath,
        policyRevision,
        policy,
        sourceFingerprint,
        physicalCompositionUnits: projection.physicalCompositionUnits,
        reservedComponentQuantities: projection.reservedComponentQuantities,
        availableComponentQuantities: projection.availableComponentQuantities,
        availableToPromiseUnits: projection.availableToPromiseUnits,
        publishableUnits: projection.publishableUnits,
        source,
        createdAt: FieldValue.serverTimestamp(),
      });
    }
    transaction.set(currentReference, {
      storeId,
      productId,
      channel,
      snapshotId,
      sourceFingerprint,
      publishableUnits: projection.publishableUnits,
      availableToPromiseUnits: projection.availableToPromiseUnits,
      policyRevision,
      authority: 'latest_channel_availability_snapshot_pointer',
      updatedAt: FieldValue.serverTimestamp(),
    });

    return {
      snapshotId,
      storeId,
      productId,
      channel,
      physicalCompositionUnits: projection.physicalCompositionUnits,
      availableToPromiseUnits: projection.availableToPromiseUnits,
      publishableUnits: projection.publishableUnits,
      policyRevision,
      sourceFingerprint,
      alreadyExisted: existingSnapshot.exists,
    };
  });
};
