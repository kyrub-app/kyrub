import { createHash, timingSafeEqual } from 'node:crypto';
import { FieldValue } from 'firebase-admin/firestore';
import { adminDb } from '../firebaseAdmin.js';
import { mercadoLivreGetJson } from './mercadoLivreOauthService.js';
import { mercadoLivrePutJson } from './mercadoLivrePutJson.js';
import { getStoreConnectionRegistryRecord } from './storeConnectionRegistry.js';

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
  canonicalBaselineHash: string;
  canonicalTargetHash: string;
  providerObservedHash: string;
  payload: Record<string, unknown>;
  payloadHash: string;
  tokenHash: string;
  status: 'authorized';
  consumptionStatus: 'available' | 'executing' | 'consumed' | 'reconciliation_required' | 'rejected';
  useCount: number;
  expiresAtMillis: number;
  authority: 'store_owner_bound_listing_update_authorization';
}

interface ProposalRecord {
  schemaVersion: 2;
  id: string;
  storeId: string;
  provider: 'mercado_livre';
  connectionId: string;
  bindingId: string;
  externalItemId: string;
  canonicalStoreId: string;
  canonicalProductId: string;
  canonicalBaselineHash: string;
  canonicalTargetHash: string;
  providerObservedHash: string;
  status: 'review_required';
  executionStatus: 'authorized' | 'executing' | 'provider_write_succeeded' | 'reconciliation_required' | 'provider_rejected';
  updateAuthorizationId: string;
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
  canonicalBaselineHash: string;
}

interface ProviderItem {
  id?: unknown;
  seller_id?: unknown;
  title?: unknown;
  price?: unknown;
  available_quantity?: unknown;
  category_id?: unknown;
  status?: unknown;
  permalink?: unknown;
}

const clean = (value: unknown, maximum = 2_000): string =>
  typeof value === 'string' || typeof value === 'number'
    ? String(value).replace(/\s+/g, ' ').trim().slice(0, maximum)
    : '';

const finiteNonNegative = (value: unknown): number | null => {
  if (value === null || value === undefined || value === '') return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : null;
};

const integerNonNegative = (value: unknown): number | null => {
  if (value === null || value === undefined || value === '') return null;
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) && parsed >= 0 ? parsed : null;
};

const sha256 = (value: string): string => createHash('sha256').update(value).digest('hex');
const payloadHash = (value: Record<string, unknown>): string => sha256(JSON.stringify(value));
const canonicalHash = (value: unknown): string | null => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const record = value as Record<string, unknown>;
  const name = clean(record.name, 120);
  const price = finiteNonNegative(record.price);
  const stock = integerNonNegative(record.stock);
  const category = clean(record.category, 160);
  if (!name || price === null || stock === null || !category || record.isService !== false) return null;
  return sha256(JSON.stringify({ name, price, stock, category, image: clean(record.image, 2_000), isService: false }));
};
const providerHash = (state: { name: string; price: number; availableQuantity: number | null; categoryId: string; status: string }): string =>
  sha256(JSON.stringify(state));

const safeHashEquals = (expectedHex: string, actualHex: string): boolean => {
  if (!/^[a-f0-9]{64}$/i.test(expectedHex) || !/^[a-f0-9]{64}$/i.test(actualHex)) return false;
  return timingSafeEqual(Buffer.from(expectedHex, 'hex'), Buffer.from(actualHex, 'hex'));
};

const assertAuthorization = (storeId: string, authorizationId: string, value: unknown): AuthorizationRecord => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('MERCADO_LIVRE_BOUND_LISTING_UPDATE_AUTHORIZATION_NOT_FOUND');
  const record = value as Record<string, unknown>;
  if (
    clean(record.id, 160) !== authorizationId || clean(record.storeId, 160) !== storeId || record.provider !== 'mercado_livre' ||
    record.status !== 'authorized' || record.authority !== 'store_owner_bound_listing_update_authorization' ||
    !clean(record.proposalId, 160) || !clean(record.connectionId, 200) || !clean(record.bindingId, 160) ||
    !clean(record.externalItemId, 160) || !clean(record.canonicalStoreId, 160) || !clean(record.canonicalProductId, 160) ||
    !clean(record.canonicalBaselineHash, 80) || !clean(record.canonicalTargetHash, 80) || !clean(record.providerObservedHash, 80) ||
    !record.payload || typeof record.payload !== 'object' || Array.isArray(record.payload) || !clean(record.payloadHash, 80) ||
    !clean(record.tokenHash, 80) || !Number.isFinite(Number(record.expiresAtMillis))
  ) throw new Error('MERCADO_LIVRE_BOUND_LISTING_UPDATE_AUTHORIZATION_INVALID');
  return record as unknown as AuthorizationRecord;
};

const assertProposal = (authorization: AuthorizationRecord, value: unknown): ProposalRecord => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('MERCADO_LIVRE_BOUND_LISTING_UPDATE_PROPOSAL_NOT_FOUND');
  const record = value as Record<string, unknown>;
  if (
    Number(record.schemaVersion) !== 2 || clean(record.id, 160) !== authorization.proposalId || clean(record.storeId, 160) !== authorization.storeId ||
    record.provider !== 'mercado_livre' || clean(record.connectionId, 200) !== authorization.connectionId ||
    clean(record.bindingId, 160) !== authorization.bindingId || clean(record.externalItemId, 160) !== authorization.externalItemId ||
    clean(record.canonicalStoreId, 160) !== authorization.canonicalStoreId || clean(record.canonicalProductId, 160) !== authorization.canonicalProductId ||
    clean(record.canonicalBaselineHash, 80) !== authorization.canonicalBaselineHash ||
    clean(record.canonicalTargetHash, 80) !== authorization.canonicalTargetHash ||
    clean(record.providerObservedHash, 80) !== authorization.providerObservedHash ||
    clean(record.updateAuthorizationId, 160) !== authorization.id
  ) throw new Error('MERCADO_LIVRE_BOUND_LISTING_UPDATE_PROPOSAL_STALE');
  return record as unknown as ProposalRecord;
};

const assertBinding = (authorization: AuthorizationRecord, value: unknown): BindingRecord => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('MERCADO_LIVRE_EXTERNAL_BINDING_NOT_FOUND');
  const record = value as Record<string, unknown>;
  if (
    clean(record.id, 160) !== authorization.bindingId || clean(record.storeId, 160) !== authorization.storeId ||
    record.provider !== 'mercado_livre' || record.status !== 'active' || clean(record.connectionId, 200) !== authorization.connectionId ||
    clean(record.externalItemId, 160) !== authorization.externalItemId || clean(record.canonicalStoreId, 160) !== authorization.canonicalStoreId ||
    clean(record.canonicalProductId, 160) !== authorization.canonicalProductId || clean(record.canonicalBaselineHash, 80) !== authorization.canonicalBaselineHash
  ) throw new Error('MERCADO_LIVRE_EXTERNAL_BINDING_CONFLICT');
  return record as unknown as BindingRecord;
};

const observedProviderHash = (authorization: AuthorizationRecord, externalAccountId: string, value: unknown): string => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('MERCADO_LIVRE_ITEM_RESPONSE_INVALID');
  const item = value as Record<string, unknown>;
  const id = clean(item.id, 160);
  const sellerId = clean(item.seller_id, 160);
  const name = clean(item.title, 120);
  const price = finiteNonNegative(item.price);
  if (id !== authorization.externalItemId || sellerId !== externalAccountId || !name || price === null) {
    throw new Error('MERCADO_LIVRE_BOUND_LISTING_IDENTITY_MISMATCH');
  }
  return providerHash({
    name,
    price,
    availableQuantity: finiteNonNegative(item.available_quantity),
    categoryId: clean(item.category_id, 160),
    status: clean(item.status, 80),
  });
};

const assertUpdatePayload = (payload: Record<string, unknown>): void => {
  const keys = Object.keys(payload).sort();
  if (!keys.length || keys.some(key => key !== 'price' && key !== 'title')) throw new Error('MERCADO_LIVRE_BOUND_LISTING_UPDATE_PAYLOAD_INVALID');
  if ('title' in payload && !clean(payload.title, 120)) throw new Error('MERCADO_LIVRE_BOUND_LISTING_UPDATE_PAYLOAD_INVALID');
  if ('price' in payload && finiteNonNegative(payload.price) === null) throw new Error('MERCADO_LIVRE_BOUND_LISTING_UPDATE_PAYLOAD_INVALID');
};

const isDefiniteProviderRejection = (error: unknown): boolean => {
  const message = error instanceof Error ? error.message : String(error);
  const match = /MERCADO_LIVRE_API_FAILED:HTTP_(\d{3})/.exec(message);
  if (!match) return false;
  const status = Number(match[1]);
  return status >= 400 && status < 500;
};

export interface MercadoLivreBoundListingUpdateExecutionResult {
  proposalId: string;
  authorizationId: string;
  executionId: string;
  bindingId: string;
  externalItemId: string;
  status: 'provider_write_succeeded';
  providerStatus: string;
  permalink?: string;
}

export const executeAuthorizedMercadoLivreBoundListingUpdate = async (input: {
  storeId: string;
  authorizationId: string;
  authorizationToken: string;
  executedByUserId: string;
}): Promise<MercadoLivreBoundListingUpdateExecutionResult> => {
  const storeId = input.storeId.trim();
  const authorizationId = input.authorizationId.trim();
  const authorizationToken = input.authorizationToken.trim();
  const executedByUserId = input.executedByUserId.trim();
  if (!storeId || !authorizationId || !authorizationToken || executedByUserId !== storeId) {
    throw new Error('MERCADO_LIVRE_BOUND_LISTING_UPDATE_EXECUTION_TARGET_INVALID');
  }

  const authorizationRef = adminDb.doc(`stores/${storeId}/catalogOutboundUpdateAuthorizations/${authorizationId}`);
  const authorizationDoc = await authorizationRef.get();
  if (!authorizationDoc.exists) throw new Error('MERCADO_LIVRE_BOUND_LISTING_UPDATE_AUTHORIZATION_NOT_FOUND');
  const authorization = assertAuthorization(storeId, authorizationId, authorizationDoc.data());
  if (!safeHashEquals(authorization.tokenHash, sha256(authorizationToken))) throw new Error('MERCADO_LIVRE_BOUND_LISTING_UPDATE_TOKEN_INVALID');
  if (authorization.expiresAtMillis <= Date.now()) throw new Error('MERCADO_LIVRE_BOUND_LISTING_UPDATE_AUTHORIZATION_EXPIRED');
  if (authorization.consumptionStatus !== 'available' || authorization.useCount !== 0) throw new Error('MERCADO_LIVRE_BOUND_LISTING_UPDATE_AUTHORIZATION_ALREADY_CONSUMED');
  if (!safeHashEquals(authorization.payloadHash, payloadHash(authorization.payload))) throw new Error('MERCADO_LIVRE_BOUND_LISTING_UPDATE_PAYLOAD_STALE');
  assertUpdatePayload(authorization.payload);

  const proposalRef = adminDb.doc(`stores/${storeId}/catalogOutboundUpdateProposals/${authorization.proposalId}`);
  const bindingRef = adminDb.doc(`stores/${storeId}/externalCatalogBindings/${authorization.bindingId}`);
  const canonicalRef = adminDb.doc(`stores/${authorization.canonicalStoreId}/products/${authorization.canonicalProductId}`);
  const executionId = `mlupdexec_${sha256(`${storeId}:${authorizationId}`).slice(0, 32)}`;
  const executionRef = adminDb.doc(`stores/${storeId}/catalogOutboundUpdateExecutions/${executionId}`);

  const connection = await getStoreConnectionRegistryRecord({ storeId, connectionId: authorization.connectionId });
  if (!connection || connection.provider !== 'mercado_livre' || connection.status !== 'connected' || connection.syncAuthority !== 'manual_review') {
    throw new Error('MERCADO_LIVRE_CONNECTION_INVALID');
  }
  const providerBefore = await mercadoLivreGetJson<unknown>(storeId, `/items/${encodeURIComponent(authorization.externalItemId)}`);
  const providerBeforeHash = observedProviderHash(authorization, connection.externalAccountId, providerBefore);
  if (!safeHashEquals(authorization.providerObservedHash, providerBeforeHash)) throw new Error('MERCADO_LIVRE_BOUND_LISTING_UPDATE_PROVIDER_STALE');

  const reservedAt = new Date().toISOString();
  await adminDb.runTransaction(async transaction => {
    const [currentAuthorizationDoc, proposalDoc, bindingDoc, canonicalDoc, executionDoc] = await Promise.all([
      transaction.get(authorizationRef), transaction.get(proposalRef), transaction.get(bindingRef), transaction.get(canonicalRef), transaction.get(executionRef),
    ]);
    if (!currentAuthorizationDoc.exists) throw new Error('MERCADO_LIVRE_BOUND_LISTING_UPDATE_AUTHORIZATION_NOT_FOUND');
    const currentAuthorization = assertAuthorization(storeId, authorizationId, currentAuthorizationDoc.data());
    const proposal = assertProposal(currentAuthorization, proposalDoc.data());
    assertBinding(currentAuthorization, bindingDoc.data());
    const currentCanonicalHash = canonicalHash(canonicalDoc.data());
    if (
      currentAuthorization.consumptionStatus !== 'available' || currentAuthorization.useCount !== 0 ||
      currentAuthorization.expiresAtMillis <= Date.now() || executionDoc.exists || proposal.executionStatus !== 'authorized' ||
      !safeHashEquals(currentAuthorization.payloadHash, payloadHash(currentAuthorization.payload)) ||
      !safeHashEquals(currentAuthorization.providerObservedHash, providerBeforeHash) ||
      !currentCanonicalHash || !safeHashEquals(currentAuthorization.canonicalTargetHash, currentCanonicalHash)
    ) throw new Error('MERCADO_LIVRE_BOUND_LISTING_UPDATE_EXECUTION_STALE');

    transaction.update(authorizationRef, {
      consumptionStatus: 'executing',
      useCount: 1,
      consumedByExecutionId: executionId,
      executionReservedAt: reservedAt,
      serverExecutionReservedAt: FieldValue.serverTimestamp(),
    });
    transaction.update(proposalRef, {
      executionStatus: 'executing',
      updateExecutionId: executionId,
      updateExecutionReservedAt: reservedAt,
      serverUpdateExecutionReservedAt: FieldValue.serverTimestamp(),
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
      canonicalBaselineHash: currentAuthorization.canonicalBaselineHash,
      canonicalTargetHash: currentAuthorization.canonicalTargetHash,
      providerObservedHash: currentAuthorization.providerObservedHash,
      payloadHash: currentAuthorization.payloadHash,
      status: 'executing',
      authority: 'consumed_store_owner_bound_listing_update_authorization',
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
        failureCode: rejected ? 'definite_provider_rejection' : 'ambiguous_provider_result',
        failedAt,
        serverFailedAt: FieldValue.serverTimestamp(),
      });
      transaction.update(authorizationRef, {
        consumptionStatus: rejected ? 'rejected' : 'reconciliation_required',
        executionFailedAt: failedAt,
        serverExecutionFailedAt: FieldValue.serverTimestamp(),
      });
      transaction.update(proposalRef, {
        executionStatus: rejected ? 'provider_rejected' : 'reconciliation_required',
        updateExecutionFailedAt: failedAt,
        serverUpdateExecutionFailedAt: FieldValue.serverTimestamp(),
      });
    });
    throw error;
  }

  const returnedId = clean(providerItem.id, 160);
  const returnedSellerId = clean(providerItem.seller_id, 160);
  if (returnedId !== authorization.externalItemId || returnedSellerId !== connection.externalAccountId) {
    const ambiguousAt = new Date().toISOString();
    await adminDb.runTransaction(async transaction => {
      transaction.update(executionRef, { status: 'reconciliation_required', failureCode: 'provider_success_identity_unverified', ambiguousAt, serverAmbiguousAt: FieldValue.serverTimestamp() });
      transaction.update(authorizationRef, { consumptionStatus: 'reconciliation_required', serverExecutionFailedAt: FieldValue.serverTimestamp() });
      transaction.update(proposalRef, { executionStatus: 'reconciliation_required', serverUpdateExecutionFailedAt: FieldValue.serverTimestamp() });
    });
    throw new Error('MERCADO_LIVRE_BOUND_LISTING_UPDATE_RESULT_AMBIGUOUS');
  }

  const completedAt = new Date().toISOString();
  await adminDb.runTransaction(async transaction => {
    const executionDoc = await transaction.get(executionRef);
    const execution = executionDoc.data() as Record<string, unknown> | undefined;
    if (clean(execution?.status, 80) !== 'executing') throw new Error('MERCADO_LIVRE_BOUND_LISTING_UPDATE_EXECUTION_CONFLICT');
    transaction.update(executionRef, {
      status: 'provider_write_succeeded',
      providerStatus: clean(providerItem.status, 80),
      providerReturnedTitle: clean(providerItem.title, 120),
      providerReturnedPrice: finiteNonNegative(providerItem.price),
      ...(clean(providerItem.permalink, 2_000) ? { permalink: clean(providerItem.permalink, 2_000) } : {}),
      completedAt,
      serverCompletedAt: FieldValue.serverTimestamp(),
    });
    transaction.update(authorizationRef, {
      consumptionStatus: 'consumed',
      consumedAt: completedAt,
      serverConsumedAt: FieldValue.serverTimestamp(),
    });
    transaction.update(proposalRef, {
      executionStatus: 'provider_write_succeeded',
      providerWriteSucceededAt: completedAt,
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
    providerStatus: clean(providerItem.status, 80),
    ...(clean(providerItem.permalink, 2_000) ? { permalink: clean(providerItem.permalink, 2_000) } : {}),
  };
};
