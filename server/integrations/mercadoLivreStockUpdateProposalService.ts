import { createHash } from 'node:crypto';
import { FieldValue } from 'firebase-admin/firestore';
import { adminDb } from '../firebaseAdmin.js';
import { mercadoLivreGetJson } from './mercadoLivreOauthService.js';
import { getStoreConnectionRegistryRecord } from './storeConnectionRegistry.js';

type ProviderStockMode =
  | 'item_available_quantity'
  | 'user_product_seller_warehouse'
  | 'provider_managed_full'
  | 'user_product_location_review_required';

type ProposalStatus =
  | 'review_required'
  | 'no_changes'
  | 'blocked_provider_stock_mode';

interface BindingRecord {
  id: string;
  storeId: string;
  provider: 'mercado_livre';
  connectionId: string;
  externalItemId: string;
  canonicalStoreId: string;
  canonicalProductId: string;
  status: 'active';
}

interface AvailabilitySnapshot {
  snapshotId: string;
  storeId: string;
  productId: string;
  channel: 'mercado_livre';
  authority: 'kyrub_inventory_reservation_policy_snapshot';
  inventoryAuthorityOwnerUserId: string;
  policyRevision: number;
  sourceFingerprint: string;
  availableToPromiseUnits: number;
  publishableUnits: number;
}

interface ProviderItem {
  id?: unknown;
  seller_id?: unknown;
  available_quantity?: unknown;
  user_product_id?: unknown;
  status?: unknown;
}

interface UserProductStockResponse {
  locations?: unknown;
}

interface ParsedLocation {
  type: string;
  quantity: number | null;
}

const clean = (value: unknown, maximum = 500): string =>
  typeof value === 'string' || typeof value === 'number'
    ? String(value).trim().slice(0, maximum)
    : '';

const nonNegativeInteger = (value: unknown): number | null => {
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) && parsed >= 0 ? parsed : null;
};

const hash = (value: unknown): string =>
  createHash('sha256').update(JSON.stringify(value)).digest('hex');

const assertBinding = (storeId: string, bindingId: string, value: unknown): BindingRecord => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('MERCADO_LIVRE_EXTERNAL_BINDING_NOT_FOUND');
  }
  const record = value as Record<string, unknown>;
  if (
    clean(record.id, 160) !== bindingId ||
    clean(record.storeId, 160) !== storeId ||
    record.provider !== 'mercado_livre' ||
    record.status !== 'active' ||
    !clean(record.connectionId, 200) ||
    !clean(record.externalItemId, 160) ||
    !clean(record.canonicalStoreId, 160) ||
    !clean(record.canonicalProductId, 160)
  ) {
    throw new Error('MERCADO_LIVRE_EXTERNAL_BINDING_CONFLICT');
  }
  return record as unknown as BindingRecord;
};

const assertAvailabilitySnapshot = (
  binding: BindingRecord,
  proposedByUserId: string,
  value: unknown
): AvailabilitySnapshot => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('MERCADO_LIVRE_STOCK_AVAILABILITY_SNAPSHOT_NOT_FOUND');
  }
  const record = value as Record<string, unknown>;
  const publishableUnits = nonNegativeInteger(record.publishableUnits);
  const availableToPromiseUnits = nonNegativeInteger(record.availableToPromiseUnits);
  const policyRevision = nonNegativeInteger(record.policyRevision);
  if (
    clean(record.storeId, 160) !== binding.canonicalStoreId ||
    clean(record.productId, 160) !== binding.canonicalProductId ||
    record.channel !== 'mercado_livre' ||
    record.authority !== 'kyrub_inventory_reservation_policy_snapshot' ||
    clean(record.inventoryAuthorityOwnerUserId, 160) !== proposedByUserId ||
    !clean(record.snapshotId, 160) ||
    !clean(record.sourceFingerprint, 100) ||
    publishableUnits === null ||
    availableToPromiseUnits === null ||
    policyRevision === null ||
    policyRevision < 1
  ) {
    throw new Error('MERCADO_LIVRE_STOCK_AVAILABILITY_SNAPSHOT_CONFLICT');
  }
  return {
    snapshotId: clean(record.snapshotId, 160),
    storeId: binding.canonicalStoreId,
    productId: binding.canonicalProductId,
    channel: 'mercado_livre',
    authority: 'kyrub_inventory_reservation_policy_snapshot',
    inventoryAuthorityOwnerUserId: proposedByUserId,
    policyRevision,
    sourceFingerprint: clean(record.sourceFingerprint, 100),
    availableToPromiseUnits,
    publishableUnits,
  };
};

const parseLocations = (value: unknown): ParsedLocation[] => {
  if (!Array.isArray(value)) return [];
  return value.flatMap(candidate => {
    if (!candidate || typeof candidate !== 'object' || Array.isArray(candidate)) return [];
    const record = candidate as Record<string, unknown>;
    const type = clean(record.type, 100);
    if (!type) return [];
    const quantity = nonNegativeInteger(record.quantity);
    return [{ type, quantity }];
  });
};

const resolveProviderStockMode = (input: {
  userProductId: string;
  locations: ParsedLocation[];
}): { mode: ProviderStockMode; blockedReason: string } => {
  if (!input.userProductId) {
    return { mode: 'item_available_quantity', blockedReason: '' };
  }
  const types = new Set(input.locations.map(location => location.type));
  if (types.has('seller_warehouse')) {
    return {
      mode: 'user_product_seller_warehouse',
      blockedReason: 'warehouse_allocation_policy_required',
    };
  }
  if (types.size > 0 && [...types].every(type => type === 'meli_facility')) {
    return {
      mode: 'provider_managed_full',
      blockedReason: 'provider_managed_inventory',
    };
  }
  if (types.has('selling_address') || types.size > 0) {
    return {
      mode: 'user_product_location_review_required',
      blockedReason: 'user_product_location_capability_review_required',
    };
  }
  return { mode: 'item_available_quantity', blockedReason: '' };
};

export interface MercadoLivreStockUpdateProposal {
  schemaVersion: 1;
  id: string;
  storeId: string;
  provider: 'mercado_livre';
  connectionId: string;
  bindingId: string;
  externalItemId: string;
  canonicalStoreId: string;
  canonicalProductId: string;
  channelAvailabilitySnapshotId: string;
  channelAvailabilitySourceFingerprint: string;
  channelAvailabilityPolicyRevision: number;
  authority: 'channel_availability_snapshot_and_provider_api_refetch';
  status: ProposalStatus;
  executionStatus: 'not_authorized';
  targetAvailableQuantity: number;
  observedAvailableQuantity: number | null;
  providerStockMode: ProviderStockMode;
  providerUserProductId: string;
  providerStockLocations: ParsedLocation[];
  providerObservedHash: string;
  blockedReason: string;
  createdAt: string;
}

export const proposeMercadoLivreStockUpdate = async (input: {
  storeId: string;
  bindingId: string;
  channelAvailabilitySnapshotId: string;
  proposedByUserId: string;
}): Promise<MercadoLivreStockUpdateProposal> => {
  const storeId = clean(input.storeId, 160);
  const bindingId = clean(input.bindingId, 160);
  const snapshotId = clean(input.channelAvailabilitySnapshotId, 160);
  const proposedByUserId = clean(input.proposedByUserId, 160);
  if (!storeId || !bindingId || !snapshotId || proposedByUserId !== storeId) {
    throw new Error('MERCADO_LIVRE_STOCK_UPDATE_TARGET_INVALID');
  }

  const bindingRef = adminDb.doc(`stores/${storeId}/externalCatalogBindings/${bindingId}`);
  const bindingDoc = await bindingRef.get();
  const binding = assertBinding(storeId, bindingId, bindingDoc.data());
  const snapshotRef = adminDb.doc(
    `stores/${binding.canonicalStoreId}/channelAvailabilitySnapshots/${snapshotId}`
  );
  const snapshotDoc = await snapshotRef.get();
  const availability = assertAvailabilitySnapshot(
    binding,
    proposedByUserId,
    snapshotDoc.data()
  );

  const connection = await getStoreConnectionRegistryRecord({
    storeId,
    connectionId: binding.connectionId,
  });
  if (
    !connection ||
    connection.provider !== 'mercado_livre' ||
    connection.status !== 'connected' ||
    connection.syncAuthority !== 'manual_review'
  ) {
    throw new Error('MERCADO_LIVRE_CONNECTION_INVALID');
  }

  const rawItem = await mercadoLivreGetJson<unknown>(
    storeId,
    `/items/${encodeURIComponent(binding.externalItemId)}`
  );
  if (!rawItem || typeof rawItem !== 'object' || Array.isArray(rawItem)) {
    throw new Error('MERCADO_LIVRE_ITEM_RESPONSE_INVALID');
  }
  const item = rawItem as ProviderItem;
  const itemId = clean(item.id, 160);
  const sellerId = clean(item.seller_id, 160);
  if (itemId !== binding.externalItemId || sellerId !== connection.externalAccountId) {
    throw new Error('MERCADO_LIVRE_BOUND_LISTING_IDENTITY_MISMATCH');
  }
  const userProductId = clean(item.user_product_id, 160);
  let locations: ParsedLocation[] = [];
  if (userProductId) {
    const stockRaw = await mercadoLivreGetJson<UserProductStockResponse>(
      storeId,
      `/user-products/${encodeURIComponent(userProductId)}/stock`
    );
    locations = parseLocations(stockRaw?.locations);
  }
  const providerMode = resolveProviderStockMode({ userProductId, locations });
  const observedAvailableQuantity = nonNegativeInteger(item.available_quantity);
  const providerObservedHash = hash({
    itemId,
    sellerId,
    availableQuantity: observedAvailableQuantity,
    userProductId,
    locations,
    status: clean(item.status, 80),
    providerStockMode: providerMode.mode,
  });
  const status: ProposalStatus = providerMode.blockedReason
    ? 'blocked_provider_stock_mode'
    : observedAvailableQuantity === availability.publishableUnits
      ? 'no_changes'
      : 'review_required';
  const proposalId = `mlstock_${hash({
    storeId,
    bindingId,
    snapshotId: availability.snapshotId,
    sourceFingerprint: availability.sourceFingerprint,
    providerObservedHash,
    target: availability.publishableUnits,
    providerStockMode: providerMode.mode,
  }).slice(0, 40)}`;
  const proposalRef = adminDb.doc(
    `stores/${storeId}/catalogOutboundStockProposals/${proposalId}`
  );
  const existing = await proposalRef.get();
  if (existing.exists) return existing.data() as MercadoLivreStockUpdateProposal;

  const proposal: MercadoLivreStockUpdateProposal = {
    schemaVersion: 1,
    id: proposalId,
    storeId,
    provider: 'mercado_livre',
    connectionId: binding.connectionId,
    bindingId,
    externalItemId: binding.externalItemId,
    canonicalStoreId: binding.canonicalStoreId,
    canonicalProductId: binding.canonicalProductId,
    channelAvailabilitySnapshotId: availability.snapshotId,
    channelAvailabilitySourceFingerprint: availability.sourceFingerprint,
    channelAvailabilityPolicyRevision: availability.policyRevision,
    authority: 'channel_availability_snapshot_and_provider_api_refetch',
    status,
    executionStatus: 'not_authorized',
    targetAvailableQuantity: availability.publishableUnits,
    observedAvailableQuantity,
    providerStockMode: providerMode.mode,
    providerUserProductId: userProductId,
    providerStockLocations: locations,
    providerObservedHash,
    blockedReason: providerMode.blockedReason,
    createdAt: new Date().toISOString(),
  };
  await proposalRef.create({
    ...proposal,
    proposedByUserId,
    serverCreatedAt: FieldValue.serverTimestamp(),
  });
  return proposal;
};

export const listMercadoLivreStockUpdateProposals = async (input: {
  storeId: string;
  limit?: number;
}) => {
  const storeId = clean(input.storeId, 160);
  if (!storeId) throw new Error('STORE_CONNECTION_STORE_REQUIRED');
  const requested = Number(input.limit ?? 50);
  const limit = Number.isSafeInteger(requested)
    ? Math.max(1, Math.min(100, requested))
    : 50;
  const snapshot = await adminDb
    .collection(`stores/${storeId}/catalogOutboundStockProposals`)
    .limit(limit)
    .get();
  return {
    items: snapshot.docs
      .map(document => document.data() as MercadoLivreStockUpdateProposal)
      .filter(item => item.provider === 'mercado_livre' && item.storeId === storeId)
      .sort((left, right) => right.createdAt.localeCompare(left.createdAt)),
  };
};
