import { createHash, timingSafeEqual } from 'node:crypto';
import { FieldValue } from 'firebase-admin/firestore';
import { adminDb } from '../firebaseAdmin.js';
import { mercadoLivreGetJson } from './mercadoLivreOauthService.js';
import { mercadoLivrePutJson } from './mercadoLivrePutJson.js';
import { getStoreConnectionRegistryRecord } from './storeConnectionRegistry.js';
import { createChannelAvailabilitySnapshot } from '../inventory/channelAvailabilityPolicyService.js';

interface AuthorizationRecord {
  id: string;
  proposalId: string;
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
  providerObservedHash: string;
  providerStockMode: 'item_available_quantity';
  payload: { available_quantity: number };
  payloadHash: string;
  tokenHash: string;
  status: 'authorized';
  consumptionStatus: 'available' | 'executing' | 'consumed' | 'reconciliation_required' | 'rejected';
  useCount: number;
  expiresAtMillis: number;
  authority: 'store_owner_stock_projection_authorization';
}

interface ProposalRecord {
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
  providerObservedHash: string;
  providerStockMode: 'item_available_quantity';
  status: 'review_required';
  executionStatus: 'authorized' | 'executing' | 'provider_write_succeeded' | 'reconciliation_required' | 'provider_rejected';
  targetAvailableQuantity: number;
  stockAuthorizationId: string;
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

interface ProviderItem {
  id?: unknown;
  seller_id?: unknown;
  available_quantity?: unknown;
  user_product_id?: unknown;
  status?: unknown;
}

const clean = (value: unknown, maximum = 500): string =>
  typeof value === 'string' || typeof value === 'number'
    ? String(value).trim().slice(0, maximum)
    : '';

const nonNegativeInteger = (value: unknown): number | null => {
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) && parsed >= 0 ? parsed : null;
};

const sha256 = (value: string): string => createHash('sha256').update(value).digest('hex');
const stablePayloadHash = (payload: Record<string, unknown>): string => sha256(JSON.stringify(payload));

const safeHashEquals = (expectedHex: string, actualHex: string): boolean => {
  if (!/^[a-f0-9]{64}$/i.test(expectedHex) || !/^[a-f0-9]{64}$/i.test(actualHex)) return false;
  return timingSafeEqual(Buffer.from(expectedHex, 'hex'), Buffer.from(actualHex, 'hex'));
};

const assertAuthorization = (storeId: string, authorizationId: string, value: unknown): AuthorizationRecord => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('MERCADO_LIVRE_STOCK_UPDATE_AUTHORIZATION_NOT_FOUND');
  const record = value as Record<string, unknown>;
  const quantity = nonNegativeInteger((record.payload as Record<string, unknown> | undefined)?.available_quantity);
  if (
    clean(record.id, 160) !== authorizationId || clean(record.storeId, 160) !== storeId ||
    record.provider !== 'mercado_livre' || record.status !== 'authorized' ||
    record.authority !== 'store_owner_stock_projection_authorization' || record.providerStockMode !== 'item_available_quantity' ||
    !clean(record.proposalId, 160) || !clean(record.connectionId, 200) || !clean(record.bindingId, 160) ||
    !clean(record.externalItemId, 160) || !clean(record.canonicalStoreId, 160) || !clean(record.canonicalProductId, 160) ||
    !clean(record.channelAvailabilitySnapshotId, 160) || !clean(record.channelAvailabilitySourceFingerprint, 100) ||
    !clean(record.providerObservedHash, 80) || !clean(record.payloadHash, 80) || !clean(record.tokenHash, 80) ||
    quantity === null || !Number.isSafeInteger(Number(record.channelAvailabilityPolicyRevision)) ||
    !Number.isFinite(Number(record.expiresAtMillis))
  ) throw new Error('MERCADO_LIVRE_STOCK_UPDATE_AUTHORIZATION_INVALID');
  return record as unknown as AuthorizationRecord;
};

const assertProposal = (authorization: AuthorizationRecord, value: unknown): ProposalRecord => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('MERCADO_LIVRE_STOCK_UPDATE_PROPOSAL_NOT_FOUND');
  const record = value as Record<string, unknown>;
  if (
    clean(record.id, 160) !== authorization.proposalId || clean(record.storeId, 160) !== authorization.storeId ||
    record.provider !== 'mercado_livre' || clean(record.connectionId, 200) !== authorization.connectionId ||
    clean(record.bindingId, 160) !== authorization.bindingId || clean(record.externalItemId, 160) !== authorization.externalItemId ||
    clean(record.canonicalStoreId, 160) !== authorization.canonicalStoreId || clean(record.canonicalProductId, 160) !== authorization.canonicalProductId ||
    clean(record.channelAvailabilitySnapshotId, 160) !== authorization.channelAvailabilitySnapshotId ||
    clean(record.channelAvailabilitySourceFingerprint, 100) !== authorization.channelAvailabilitySourceFingerprint ||
    Number(record.channelAvailabilityPolicyRevision) !== authorization.channelAvailabilityPolicyRevision ||
    clean(record.providerObservedHash, 80) !== authorization.providerObservedHash || record.providerStockMode !== 'item_available_quantity' ||
    clean(record.stockAuthorizationId, 160) !== authorization.id || nonNegativeInteger(record.targetAvailableQuantity) !== authorization.payload.available_quantity
  ) throw new Error('MERCADO_LIVRE_STOCK_UPDATE_PROPOSAL_STALE');
  return record as unknown as ProposalRecord;
};

const assertBinding = (authorization: AuthorizationRecord, value: unknown): BindingRecord => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('MERCADO_LIVRE_EXTERNAL_BINDING_NOT_FOUND');
  const record = value as Record<string, unknown>;
  if (
    clean(record.id, 160) !== authorization.bindingId || clean(record.storeId, 160) !== authorization.storeId ||
    record.provider !== 'mercado_livre' || record.status !== 'active' || clean(record.connectionId, 200) !== authorization.connectionId ||
    clean(record.externalItemId, 160) !== authorization.externalItemId || clean(record.canonicalStoreId, 160) !== authorization.canonicalStoreId ||
    clean(record.canonicalProductId, 160) !== authorization.canonicalProductId
  ) throw new Error('MERCADO_LIVRE_EXTERNAL_BINDING_CONFLICT');
  return record as unknown as BindingRecord;
};

const providerObservationHash = (authorization: AuthorizationRecord, externalAccountId: string, value: unknown): string => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('MERCADO_LIVRE_ITEM_RESPONSE_INVALID');
  const item = value as ProviderItem;
  const itemId = clean(item.id, 160);
  const sellerId = clean(item.seller_id, 160);
  const userProductId = clean(item.user_product_id, 160);
  if (itemId !== authorization.externalItemId || sellerId !== externalAccountId || userProductId) {
    throw new Error('MERCADO_LIVRE_STOCK_UPDATE_PROVIDER_MODE_STALE');
  }
  return sha256(JSON.stringify({
    itemId,
    sellerId,
    availableQuantity: nonNegativeInteger(item.available_quantity),
    userProductId,
    locations: [],
    status: clean(item.status, 80),
    providerStockMode: 'item_available_quantity',
  }));
};

const isDefiniteProviderRejection = (error: unknown): boolean => {
  const message = error instanceof Error ? error.message : String(error);
  const match = /MERCADO_LIVRE_API_FAILED:HTTP_(\d{3})/.exec(message);
  if (!match) return false;
  const status = Number(match[1]);
  return status >= 400 && status < 500;
};

export interface MercadoLivreStockUpdateExecutionResult {
  proposalId: string;
  authorizationId: string;
  executionId: string;
  bindingId: string;
  externalItemId: string;
  status: 'provider_write_succeeded';
  targetAvailableQuantity: number;
}

export const executeAuthorizedMercadoLivreStockUpdate = async (input: {
  storeId: string;
  authorizationId: string;
  authorizationToken: string;
  executedByUserId: string;
}): Promise<MercadoLivreStockUpdateExecutionResult> => {
  const storeId = clean(input.storeId, 160);
  const authorizationId = clean(input.authorizationId, 160);
  const authorizationToken = input.authorizationToken.trim();
  const executedByUserId = clean(input.executedByUserId, 160);
  if (!storeId || !authorizationId || !authorizationToken || executedByUserId !== storeId) {
    throw new Error('MERCADO_LIVRE_STOCK_UPDATE_EXECUTION_TARGET_INVALID');
  }

  const authorizationRef = adminDb.doc(`stores/${storeId}/catalogOutboundStockAuthorizations/${authorizationId}`);
  const authorizationDoc = await authorizationRef.get();
  const authorization = assertAuthorization(storeId, authorizationId, authorizationDoc.data());
  if (!safeHashEquals(authorization.tokenHash, sha256(authorizationToken))) throw new Error('MERCADO_LIVRE_STOCK_UPDATE_TOKEN_INVALID');
  if (authorization.expiresAtMillis <= Date.now()) throw new Error('MERCADO_LIVRE_STOCK_UPDATE_AUTHORIZATION_EXPIRED');
  if (authorization.consumptionStatus !== 'available' || authorization.useCount !== 0) throw new Error('MERCADO_LIVRE_STOCK_UPDATE_AUTHORIZATION_ALREADY_CONSUMED');
  if (!safeHashEquals(authorization.payloadHash, stablePayloadHash(authorization.payload))) throw new Error('MERCADO_LIVRE_STOCK_UPDATE_PAYLOAD_STALE');
  if (Object.keys(authorization.payload).length !== 1 || nonNegativeInteger(authorization.payload.available_quantity) === null) {
    throw new Error('MERCADO_LIVRE_STOCK_UPDATE_PAYLOAD_INVALID');
  }

  const proposalRef = adminDb.doc(`stores/${storeId}/catalogOutboundStockProposals/${authorization.proposalId}`);
  const bindingRef = adminDb.doc(`stores/${storeId}/externalCatalogBindings/${authorization.bindingId}`);
  const executionId = `mlstockexec_${sha256(`${storeId}:${authorizationId}`).slice(0, 32)}`;
  const executionRef = adminDb.doc(`stores/${storeId}/catalogOutboundStockExecutions/${executionId}`);

  const currentAvailability = await createChannelAvailabilitySnapshot({
    storeId: authorization.canonicalStoreId,
    productId: authorization.canonicalProductId,
    channel: 'mercado_livre',
    requestedByUserId: executedByUserId,
  });
  if (
    currentAvailability.snapshotId !== authorization.channelAvailabilitySnapshotId ||
    currentAvailability.sourceFingerprint !== authorization.channelAvailabilitySourceFingerprint ||
    currentAvailability.policyRevision !== authorization.channelAvailabilityPolicyRevision ||
    currentAvailability.publishableUnits !== authorization.payload.available_quantity
  ) throw new Error('MERCADO_LIVRE_STOCK_UPDATE_AVAILABILITY_STALE');

  const connection = await getStoreConnectionRegistryRecord({ storeId, connectionId: authorization.connectionId });
  if (!connection || connection.provider !== 'mercado_livre' || connection.status !== 'connected' || connection.syncAuthority !== 'manual_review') {
    throw new Error('MERCADO_LIVRE_CONNECTION_INVALID');
  }
  const providerBefore = await mercadoLivreGetJson<unknown>(storeId, `/items/${encodeURIComponent(authorization.externalItemId)}`);
  const providerBeforeHash = providerObservationHash(authorization, connection.externalAccountId, providerBefore);
  if (!safeHashEquals(authorization.providerObservedHash, providerBeforeHash)) throw new Error('MERCADO_LIVRE_STOCK_UPDATE_PROVIDER_STALE');

  const reservedAt = new Date().toISOString();
  await adminDb.runTransaction(async transaction => {
    const [currentAuthorizationDoc, proposalDoc, bindingDoc, executionDoc] = await Promise.all([
      transaction.get(authorizationRef), transaction.get(proposalRef), transaction.get(bindingRef), transaction.get(executionRef),
    ]);
    const currentAuthorization = assertAuthorization(storeId, authorizationId, currentAuthorizationDoc.data());
    const proposal = assertProposal(currentAuthorization, proposalDoc.data());
    assertBinding(currentAuthorization, bindingDoc.data());
    if (
      currentAuthorization.consumptionStatus !== 'available' || currentAuthorization.useCount !== 0 ||
      currentAuthorization.expiresAtMillis <= Date.now() || executionDoc.exists || proposal.executionStatus !== 'authorized' ||
      !safeHashEquals(currentAuthorization.payloadHash, stablePayloadHash(currentAuthorization.payload)) ||
      !safeHashEquals(currentAuthorization.providerObservedHash, providerBeforeHash)
    ) throw new Error('MERCADO_LIVRE_STOCK_UPDATE_EXECUTION_STALE');

    transaction.update(authorizationRef, {
      consumptionStatus: 'executing',
      useCount: 1,
      consumedByExecutionId: executionId,
      executionReservedAt: reservedAt,
      serverExecutionReservedAt: FieldValue.serverTimestamp(),
    });
    transaction.update(proposalRef, {
      executionStatus: 'executing',
      stockExecutionId: executionId,
      stockExecutionReservedAt: reservedAt,
      serverStockExecutionReservedAt: FieldValue.serverTimestamp(),
    });
    transaction.create(executionRef, {
      schemaVersion: 1,
      id: executionId,
      proposalId: currentAuthorization.proposalId,
      authorizationId,
      storeId,
      provider: 'mercado_livre',
      connectionId: currentAuthorization.connectionId,
      bindingId: currentAuthorization.bindingId,
      externalItemId: currentAuthorization.externalItemId,
      canonicalStoreId: currentAuthorization.canonicalStoreId,
      canonicalProductId: currentAuthorization.canonicalProductId,
      channelAvailabilitySnapshotId: currentAuthorization.channelAvailabilitySnapshotId,
      channelAvailabilitySourceFingerprint: currentAuthorization.channelAvailabilitySourceFingerprint,
      channelAvailabilityPolicyRevision: currentAuthorization.channelAvailabilityPolicyRevision,
      providerObservedHash: currentAuthorization.providerObservedHash,
      providerStockMode: 'item_available_quantity',
      targetAvailableQuantity: currentAuthorization.payload.available_quantity,
      payloadHash: currentAuthorization.payloadHash,
      status: 'executing',
      authority: 'consumed_store_owner_stock_projection_authorization',
      executedByUserId,
      reservedAt,
      serverReservedAt: FieldValue.serverTimestamp(),
    });
  });

  let providerItem: ProviderItem;
  try {
    providerItem = await mercadoLivrePutJson<ProviderItem>(
      storeId,
      `/items/${encodeURIComponent(authorization.externalItemId)}`,
      authorization.payload
    );
  } catch (error) {
    const rejected = isDefiniteProviderRejection(error);
    const failedAt = new Date().toISOString();
    await adminDb.runTransaction(async transaction => {
      transaction.update(executionRef, {
        status: rejected ? 'provider_rejected' : 'reconciliation_required',
        providerError: (error instanceof Error ? error.message : String(error)).slice(0, 500),
        failedAt,
        serverFailedAt: FieldValue.serverTimestamp(),
      });
      transaction.update(authorizationRef, {
        consumptionStatus: rejected ? 'rejected' : 'reconciliation_required',
        providerWriteFailedAt: failedAt,
        serverProviderWriteFailedAt: FieldValue.serverTimestamp(),
      });
      transaction.update(proposalRef, {
        executionStatus: rejected ? 'provider_rejected' : 'reconciliation_required',
        providerWriteFailedAt: failedAt,
        serverProviderWriteFailedAt: FieldValue.serverTimestamp(),
      });
    });
    if (rejected) throw error;
    throw new Error('MERCADO_LIVRE_STOCK_UPDATE_RECONCILIATION_REQUIRED');
  }

  const returnedId = clean(providerItem.id, 160);
  const returnedSellerId = clean(providerItem.seller_id, 160);
  if (returnedId !== authorization.externalItemId || returnedSellerId !== connection.externalAccountId) {
    const ambiguousAt = new Date().toISOString();
    await adminDb.runTransaction(async transaction => {
      transaction.update(executionRef, {
        status: 'reconciliation_required',
        providerResponseIdentityMismatch: true,
        ambiguousAt,
        serverAmbiguousAt: FieldValue.serverTimestamp(),
      });
      transaction.update(authorizationRef, { consumptionStatus: 'reconciliation_required' });
      transaction.update(proposalRef, { executionStatus: 'reconciliation_required' });
    });
    throw new Error('MERCADO_LIVRE_STOCK_UPDATE_RECONCILIATION_REQUIRED');
  }

  const succeededAt = new Date().toISOString();
  await adminDb.runTransaction(async transaction => {
    transaction.update(executionRef, {
      status: 'provider_write_succeeded',
      providerReturnedAvailableQuantity: nonNegativeInteger(providerItem.available_quantity),
      succeededAt,
      serverSucceededAt: FieldValue.serverTimestamp(),
    });
    transaction.update(authorizationRef, {
      consumptionStatus: 'consumed',
      consumedAt: succeededAt,
      serverConsumedAt: FieldValue.serverTimestamp(),
    });
    transaction.update(proposalRef, {
      executionStatus: 'provider_write_succeeded',
      providerWriteSucceededAt: succeededAt,
      serverProviderWriteSucceededAt: FieldValue.serverTimestamp(),
    });
  });

  return {
    proposalId: authorization.proposalId,
    authorizationId,
    executionId,
    bindingId: authorization.bindingId,
    externalItemId: authorization.externalItemId,
    status: 'provider_write_succeeded',
    targetAvailableQuantity: authorization.payload.available_quantity,
  };
};
