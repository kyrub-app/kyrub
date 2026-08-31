import { createHash, randomBytes } from 'node:crypto';
import { FieldValue } from 'firebase-admin/firestore';
import { adminDb } from '../firebaseAdmin.js';
import { createChannelAvailabilitySnapshot } from '../inventory/channelAvailabilityPolicyService.js';
import { mercadoLivreGetJson } from './mercadoLivreOauthService.js';
import { getStoreConnectionRegistryRecord } from './storeConnectionRegistry.js';

type ProviderStockMode =
  | 'item_available_quantity'
  | 'user_product_seller_warehouse'
  | 'provider_managed_full'
  | 'user_product_location_review_required';

interface ProposalRecord {
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
  status: 'review_required';
  executionStatus: 'not_authorized' | 'authorized';
  targetAvailableQuantity: number;
  providerStockMode: ProviderStockMode;
  providerUserProductId: string;
  providerStockLocations: Array<{ type: string; quantity: number | null }>;
  providerObservedHash: string;
  blockedReason: string;
}

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

const clean = (value: unknown, maximum = 500): string =>
  typeof value === 'string' || typeof value === 'number'
    ? String(value).trim().slice(0, maximum)
    : '';

const nonNegativeInteger = (value: unknown): number | null => {
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) && parsed >= 0 ? parsed : null;
};

const sha256 = (value: string): string =>
  createHash('sha256').update(value).digest('hex');

const hashValue = (value: unknown): string =>
  sha256(JSON.stringify(value));

const assertProposal = (storeId: string, proposalId: string, value: unknown): ProposalRecord => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('MERCADO_LIVRE_STOCK_UPDATE_PROPOSAL_NOT_FOUND');
  }
  const record = value as Record<string, unknown>;
  const target = nonNegativeInteger(record.targetAvailableQuantity);
  const policyRevision = nonNegativeInteger(record.channelAvailabilityPolicyRevision);
  if (
    Number(record.schemaVersion) !== 1 ||
    clean(record.id, 160) !== proposalId ||
    clean(record.storeId, 160) !== storeId ||
    record.provider !== 'mercado_livre' ||
    record.authority !== 'channel_availability_snapshot_and_provider_api_refetch' ||
    record.status !== 'review_required' ||
    (record.executionStatus !== 'not_authorized' && record.executionStatus !== 'authorized') ||
    record.providerStockMode !== 'item_available_quantity' ||
    clean(record.blockedReason) ||
    target === null ||
    policyRevision === null || policyRevision < 1 ||
    !clean(record.connectionId, 200) ||
    !clean(record.bindingId, 160) ||
    !clean(record.externalItemId, 160) ||
    !clean(record.canonicalStoreId, 160) ||
    !clean(record.canonicalProductId, 160) ||
    !clean(record.channelAvailabilitySnapshotId, 160) ||
    !clean(record.channelAvailabilitySourceFingerprint, 100) ||
    !clean(record.providerObservedHash, 100)
  ) {
    throw new Error('MERCADO_LIVRE_STOCK_UPDATE_AUTHORIZATION_NOT_READY');
  }
  return record as unknown as ProposalRecord;
};

const assertBinding = (proposal: ProposalRecord, value: unknown): BindingRecord => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('MERCADO_LIVRE_EXTERNAL_BINDING_NOT_FOUND');
  }
  const record = value as Record<string, unknown>;
  if (
    clean(record.id, 160) !== proposal.bindingId ||
    clean(record.storeId, 160) !== proposal.storeId ||
    record.provider !== 'mercado_livre' ||
    record.status !== 'active' ||
    clean(record.connectionId, 200) !== proposal.connectionId ||
    clean(record.externalItemId, 160) !== proposal.externalItemId ||
    clean(record.canonicalStoreId, 160) !== proposal.canonicalStoreId ||
    clean(record.canonicalProductId, 160) !== proposal.canonicalProductId
  ) {
    throw new Error('MERCADO_LIVRE_EXTERNAL_BINDING_CONFLICT');
  }
  return record as unknown as BindingRecord;
};

const parseLocations = (value: unknown): Array<{ type: string; quantity: number | null }> => {
  if (!Array.isArray(value)) return [];
  return value.flatMap(candidate => {
    if (!candidate || typeof candidate !== 'object' || Array.isArray(candidate)) return [];
    const record = candidate as Record<string, unknown>;
    const type = clean(record.type, 100);
    if (!type) return [];
    return [{ type, quantity: nonNegativeInteger(record.quantity) }];
  });
};

const providerObservation = async (
  storeId: string,
  proposal: ProposalRecord,
  externalAccountId: string
): Promise<{ hash: string; mode: ProviderStockMode; userProductId: string }> => {
  const raw = await mercadoLivreGetJson<unknown>(
    storeId,
    `/items/${encodeURIComponent(proposal.externalItemId)}`
  );
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    throw new Error('MERCADO_LIVRE_ITEM_RESPONSE_INVALID');
  }
  const item = raw as Record<string, unknown>;
  const itemId = clean(item.id, 160);
  const sellerId = clean(item.seller_id, 160);
  if (itemId !== proposal.externalItemId || sellerId !== externalAccountId) {
    throw new Error('MERCADO_LIVRE_BOUND_LISTING_IDENTITY_MISMATCH');
  }
  const userProductId = clean(item.user_product_id, 160);
  let locations: Array<{ type: string; quantity: number | null }> = [];
  if (userProductId) {
    const stockRaw = await mercadoLivreGetJson<{ locations?: unknown }>(
      storeId,
      `/user-products/${encodeURIComponent(userProductId)}/stock`
    );
    locations = parseLocations(stockRaw?.locations);
  }
  const types = new Set(locations.map(location => location.type));
  const mode: ProviderStockMode = !userProductId
    ? 'item_available_quantity'
    : types.has('seller_warehouse')
      ? 'user_product_seller_warehouse'
      : types.size > 0 && [...types].every(type => type === 'meli_facility')
        ? 'provider_managed_full'
        : types.size > 0
          ? 'user_product_location_review_required'
          : 'item_available_quantity';
  return {
    mode,
    userProductId,
    hash: hashValue({
      itemId,
      sellerId,
      availableQuantity: nonNegativeInteger(item.available_quantity),
      userProductId,
      locations,
      status: clean(item.status, 80),
      providerStockMode: mode,
    }),
  };
};

export interface MercadoLivreStockUpdateAuthorizationResult {
  proposalId: string;
  authorizationId: string;
  authorizationToken: string;
  externalItemId: string;
  targetAvailableQuantity: number;
  payloadHash: string;
  expiresAtMillis: number;
  status: 'authorized';
  executionStatus: 'authorized';
  authority: 'store_owner_stock_projection_authorization';
}

export const authorizeMercadoLivreStockUpdate = async (input: {
  storeId: string;
  proposalId: string;
  authorizedByUserId: string;
}): Promise<MercadoLivreStockUpdateAuthorizationResult> => {
  const storeId = clean(input.storeId, 160);
  const proposalId = clean(input.proposalId, 160);
  const authorizedByUserId = clean(input.authorizedByUserId, 160);
  if (!storeId || !proposalId || authorizedByUserId !== storeId) {
    throw new Error('MERCADO_LIVRE_STOCK_UPDATE_AUTHORIZATION_TARGET_INVALID');
  }

  const proposalRef = adminDb.doc(`stores/${storeId}/catalogOutboundStockProposals/${proposalId}`);
  const proposalDoc = await proposalRef.get();
  const proposal = assertProposal(storeId, proposalId, proposalDoc.data());
  if (proposal.executionStatus !== 'not_authorized') {
    throw new Error('MERCADO_LIVRE_STOCK_UPDATE_ALREADY_AUTHORIZED');
  }

  const refreshedAvailability = await createChannelAvailabilitySnapshot({
    storeId: proposal.canonicalStoreId,
    productId: proposal.canonicalProductId,
    channel: 'mercado_livre',
    requestedByUserId: authorizedByUserId,
  });
  if (
    refreshedAvailability.snapshotId !== proposal.channelAvailabilitySnapshotId ||
    refreshedAvailability.sourceFingerprint !== proposal.channelAvailabilitySourceFingerprint ||
    refreshedAvailability.policyRevision !== proposal.channelAvailabilityPolicyRevision ||
    refreshedAvailability.publishableUnits !== proposal.targetAvailableQuantity
  ) {
    throw new Error('MERCADO_LIVRE_STOCK_UPDATE_AVAILABILITY_STALE');
  }

  const bindingRef = adminDb.doc(`stores/${storeId}/externalCatalogBindings/${proposal.bindingId}`);
  const bindingDoc = await bindingRef.get();
  assertBinding(proposal, bindingDoc.data());
  const connection = await getStoreConnectionRegistryRecord({
    storeId,
    connectionId: proposal.connectionId,
  });
  if (
    !connection ||
    connection.provider !== 'mercado_livre' ||
    connection.status !== 'connected' ||
    connection.syncAuthority !== 'manual_review'
  ) {
    throw new Error('MERCADO_LIVRE_CONNECTION_INVALID');
  }

  const observed = await providerObservation(storeId, proposal, connection.externalAccountId);
  if (
    observed.mode !== 'item_available_quantity' ||
    observed.hash !== proposal.providerObservedHash ||
    observed.userProductId !== proposal.providerUserProductId
  ) {
    throw new Error('MERCADO_LIVRE_STOCK_UPDATE_PROVIDER_STALE');
  }

  const payload = { available_quantity: proposal.targetAvailableQuantity };
  const payloadHash = hashValue(payload);
  const authorizationToken = randomBytes(32).toString('base64url');
  const tokenHash = sha256(authorizationToken);
  const authorizationId = `mlstockauth_${sha256(`${storeId}:${proposalId}:${authorizationToken}`).slice(0, 32)}`;
  const authorizationRef = adminDb.doc(
    `stores/${storeId}/catalogOutboundStockAuthorizations/${authorizationId}`
  );
  const authorizedAt = new Date().toISOString();
  const expiresAtMillis = Date.now() + 15 * 60 * 1000;

  await adminDb.runTransaction(async transaction => {
    const [currentProposalDoc, currentBindingDoc, currentSnapshotDoc, currentPointerDoc, existingAuthorizationDoc] =
      await Promise.all([
        transaction.get(proposalRef),
        transaction.get(bindingRef),
        transaction.get(adminDb.doc(
          `stores/${proposal.canonicalStoreId}/channelAvailabilitySnapshots/${proposal.channelAvailabilitySnapshotId}`
        )),
        transaction.get(adminDb.doc(
          `stores/${proposal.canonicalStoreId}/channelAvailabilityCurrent/mercado_livre__${proposal.canonicalProductId.replace(/[^a-zA-Z0-9_-]/g, '_')}`
        )),
        transaction.get(authorizationRef),
      ]);
    const currentProposal = assertProposal(storeId, proposalId, currentProposalDoc.data());
    assertBinding(currentProposal, currentBindingDoc.data());
    const currentSnapshot = currentSnapshotDoc.data() as Record<string, unknown> | undefined;
    const currentPointer = currentPointerDoc.data() as Record<string, unknown> | undefined;
    if (
      currentProposal.executionStatus !== 'not_authorized' ||
      currentProposal.providerObservedHash !== observed.hash ||
      currentProposal.channelAvailabilitySnapshotId !== refreshedAvailability.snapshotId ||
      currentProposal.channelAvailabilitySourceFingerprint !== refreshedAvailability.sourceFingerprint ||
      currentProposal.channelAvailabilityPolicyRevision !== refreshedAvailability.policyRevision ||
      currentProposal.targetAvailableQuantity !== refreshedAvailability.publishableUnits ||
      clean(currentSnapshot?.sourceFingerprint, 100) !== refreshedAvailability.sourceFingerprint ||
      clean(currentPointer?.snapshotId, 160) !== refreshedAvailability.snapshotId ||
      clean(currentPointer?.sourceFingerprint, 100) !== refreshedAvailability.sourceFingerprint ||
      existingAuthorizationDoc.exists
    ) {
      throw new Error('MERCADO_LIVRE_STOCK_UPDATE_AUTHORIZATION_CONFLICT');
    }

    transaction.create(authorizationRef, {
      schemaVersion: 1,
      id: authorizationId,
      proposalId,
      storeId,
      provider: 'mercado_livre',
      connectionId: proposal.connectionId,
      bindingId: proposal.bindingId,
      externalItemId: proposal.externalItemId,
      canonicalStoreId: proposal.canonicalStoreId,
      canonicalProductId: proposal.canonicalProductId,
      channelAvailabilitySnapshotId: proposal.channelAvailabilitySnapshotId,
      channelAvailabilitySourceFingerprint: proposal.channelAvailabilitySourceFingerprint,
      channelAvailabilityPolicyRevision: proposal.channelAvailabilityPolicyRevision,
      providerObservedHash: proposal.providerObservedHash,
      providerStockMode: 'item_available_quantity',
      payload,
      payloadHash,
      tokenHash,
      status: 'authorized',
      consumptionStatus: 'available',
      useCount: 0,
      expiresAtMillis,
      authority: 'store_owner_stock_projection_authorization',
      authorizedByUserId,
      authorizedAt,
      serverAuthorizedAt: FieldValue.serverTimestamp(),
    });
    transaction.update(proposalRef, {
      executionStatus: 'authorized',
      stockAuthorizationId: authorizationId,
      stockAuthorizationAuthority: 'store_owner_stock_projection_authorization',
      stockAuthorizedByUserId: authorizedByUserId,
      stockAuthorizedAt: authorizedAt,
      serverStockAuthorizedAt: FieldValue.serverTimestamp(),
    });
  });

  return {
    proposalId,
    authorizationId,
    authorizationToken,
    externalItemId: proposal.externalItemId,
    targetAvailableQuantity: proposal.targetAvailableQuantity,
    payloadHash,
    expiresAtMillis,
    status: 'authorized',
    executionStatus: 'authorized',
    authority: 'store_owner_stock_projection_authorization',
  };
};
