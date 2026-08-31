import { createHash } from 'node:crypto';
import { FieldValue } from 'firebase-admin/firestore';
import { adminDb } from '../firebaseAdmin.js';
import { mercadoLivreGetJson } from './mercadoLivreOauthService.js';
import { getStoreConnectionRegistryRecord } from './storeConnectionRegistry.js';

interface ExecutionRecord {
  id: string;
  proposalId: string;
  authorizationId: string;
  storeId: string;
  provider: 'mercado_livre';
  connectionId: string;
  bindingId: string;
  externalItemId: string;
  canonicalStoreId: string;
  canonicalProductId: string;
  canonicalBaselineHash: string;
  canonicalTargetHash: string;
  status: 'provider_write_succeeded' | 'reconciliation_required';
}

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
  payload: Record<string, unknown>;
  payloadHash: string;
  authority: 'store_owner_bound_listing_update_authorization';
  consumptionStatus: 'consumed' | 'reconciliation_required';
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

interface CanonicalState {
  name: string;
  price: number;
  stock: number;
  category: string;
  image: string;
}

interface BaselineRecord {
  id: string;
  storeId: string;
  bindingId: string;
  canonicalStoreId: string;
  canonicalProductId: string;
  baselineHash: string;
  baseline: CanonicalState;
}

interface ProviderItem {
  id?: unknown;
  seller_id?: unknown;
  title?: unknown;
  price?: unknown;
  available_quantity?: unknown;
  category_id?: unknown;
  status?: unknown;
  seller_custom_field?: unknown;
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
const baselineHash = (state: CanonicalState): string => sha256(JSON.stringify({ ...state, isService: false }));
const payloadHash = (value: Record<string, unknown>): string => sha256(JSON.stringify(value));

const assertExecution = (storeId: string, executionId: string, value: unknown): ExecutionRecord => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('MERCADO_LIVRE_BOUND_LISTING_UPDATE_EXECUTION_NOT_FOUND');
  const record = value as Record<string, unknown>;
  if (
    clean(record.id, 160) !== executionId || clean(record.storeId, 160) !== storeId || record.provider !== 'mercado_livre' ||
    (record.status !== 'provider_write_succeeded' && record.status !== 'reconciliation_required') ||
    !clean(record.proposalId, 160) || !clean(record.authorizationId, 160) || !clean(record.connectionId, 200) ||
    !clean(record.bindingId, 160) || !clean(record.externalItemId, 160) || !clean(record.canonicalStoreId, 160) ||
    !clean(record.canonicalProductId, 160) || !clean(record.canonicalBaselineHash, 80) || !clean(record.canonicalTargetHash, 80)
  ) throw new Error('MERCADO_LIVRE_BOUND_LISTING_UPDATE_EXECUTION_NOT_RECONCILABLE');
  return record as unknown as ExecutionRecord;
};

const assertAuthorization = (execution: ExecutionRecord, value: unknown): AuthorizationRecord => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('MERCADO_LIVRE_BOUND_LISTING_UPDATE_AUTHORIZATION_NOT_FOUND');
  const record = value as Record<string, unknown>;
  if (
    clean(record.id, 160) !== execution.authorizationId || clean(record.proposalId, 160) !== execution.proposalId ||
    clean(record.storeId, 160) !== execution.storeId || record.provider !== 'mercado_livre' ||
    clean(record.connectionId, 200) !== execution.connectionId || clean(record.bindingId, 160) !== execution.bindingId ||
    clean(record.externalItemId, 160) !== execution.externalItemId || clean(record.canonicalStoreId, 160) !== execution.canonicalStoreId ||
    clean(record.canonicalProductId, 160) !== execution.canonicalProductId ||
    clean(record.canonicalBaselineHash, 80) !== execution.canonicalBaselineHash ||
    clean(record.canonicalTargetHash, 80) !== execution.canonicalTargetHash ||
    record.authority !== 'store_owner_bound_listing_update_authorization' ||
    (record.consumptionStatus !== 'consumed' && record.consumptionStatus !== 'reconciliation_required') ||
    !record.payload || typeof record.payload !== 'object' || Array.isArray(record.payload) ||
    !clean(record.payloadHash, 80) || payloadHash(record.payload as Record<string, unknown>) !== clean(record.payloadHash, 80)
  ) throw new Error('MERCADO_LIVRE_BOUND_LISTING_UPDATE_AUTHORIZATION_STALE');
  const payload = record.payload as Record<string, unknown>;
  const keys = Object.keys(payload);
  if (!keys.length || keys.some(key => key !== 'title' && key !== 'price')) throw new Error('MERCADO_LIVRE_BOUND_LISTING_UPDATE_PAYLOAD_INVALID');
  return record as unknown as AuthorizationRecord;
};

const assertBinding = (execution: ExecutionRecord, value: unknown): BindingRecord => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('MERCADO_LIVRE_EXTERNAL_BINDING_NOT_FOUND');
  const record = value as Record<string, unknown>;
  if (
    clean(record.id, 160) !== execution.bindingId || clean(record.storeId, 160) !== execution.storeId ||
    record.provider !== 'mercado_livre' || record.status !== 'active' || clean(record.connectionId, 200) !== execution.connectionId ||
    clean(record.externalItemId, 160) !== execution.externalItemId || clean(record.canonicalStoreId, 160) !== execution.canonicalStoreId ||
    clean(record.canonicalProductId, 160) !== execution.canonicalProductId || clean(record.canonicalBaselineHash, 80) !== execution.canonicalBaselineHash
  ) throw new Error('MERCADO_LIVRE_EXTERNAL_BINDING_CONFLICT');
  return record as unknown as BindingRecord;
};

const canonicalState = (execution: ExecutionRecord, value: unknown): CanonicalState => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('MERCADO_LIVRE_BOUND_CANONICAL_PRODUCT_NOT_FOUND');
  const record = value as Record<string, unknown>;
  const name = clean(record.name, 120);
  const price = finiteNonNegative(record.price);
  const stock = integerNonNegative(record.stock);
  const category = clean(record.category, 160);
  if (
    clean(record.id, 160) !== execution.canonicalProductId || clean(record.storeId, 160) !== execution.canonicalStoreId ||
    !name || price === null || stock === null || !category || record.isService !== false
  ) throw new Error('MERCADO_LIVRE_BOUND_CANONICAL_PRODUCT_INVALID');
  return { name, price, stock, category, image: clean(record.image, 2_000) };
};

const assertBaseline = (execution: ExecutionRecord, binding: BindingRecord, value: unknown): BaselineRecord => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('MERCADO_LIVRE_BOUND_LISTING_UPDATE_BASELINE_REQUIRED');
  const record = value as Record<string, unknown>;
  const raw = record.baseline && typeof record.baseline === 'object' && !Array.isArray(record.baseline)
    ? record.baseline as Record<string, unknown> : null;
  if (!raw) throw new Error('MERCADO_LIVRE_BOUND_LISTING_UPDATE_BASELINE_REQUIRED');
  const baseline: CanonicalState = {
    name: clean(raw.name, 120),
    price: finiteNonNegative(raw.price) ?? -1,
    stock: integerNonNegative(raw.stock) ?? -1,
    category: clean(raw.category, 160),
    image: clean(raw.image, 2_000),
  };
  if (
    !baseline.name || baseline.price < 0 || baseline.stock < 0 || !baseline.category ||
    clean(record.id, 160) !== execution.bindingId || clean(record.bindingId, 160) !== execution.bindingId ||
    clean(record.canonicalStoreId, 160) !== execution.canonicalStoreId || clean(record.canonicalProductId, 160) !== execution.canonicalProductId ||
    clean(record.baselineHash, 80) !== binding.canonicalBaselineHash || baselineHash(baseline) !== binding.canonicalBaselineHash
  ) throw new Error('MERCADO_LIVRE_BOUND_LISTING_UPDATE_BASELINE_CONFLICT');
  return { ...(record as unknown as BaselineRecord), baseline };
};

const providerItem = (execution: ExecutionRecord, externalAccountId: string, value: unknown) => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('MERCADO_LIVRE_ITEM_RESPONSE_INVALID');
  const item = value as ProviderItem;
  const externalId = clean(item.id, 160);
  const sellerId = clean(item.seller_id, 160);
  const title = clean(item.title, 120);
  const price = finiteNonNegative(item.price);
  if (externalId !== execution.externalItemId || sellerId !== externalAccountId || !title || price === null) {
    throw new Error('MERCADO_LIVRE_BOUND_LISTING_IDENTITY_MISMATCH');
  }
  return {
    externalId,
    title,
    price,
    availableQuantity: finiteNonNegative(item.available_quantity),
    status: clean(item.status, 80),
    categoryId: clean(item.category_id, 160),
    ...(clean(item.seller_custom_field, 240) ? { sellerSku: clean(item.seller_custom_field, 240) } : {}),
  };
};

const providerMatchesAuthorizedTarget = (authorization: AuthorizationRecord, item: { title: string; price: number }): boolean => {
  if ('title' in authorization.payload && clean(authorization.payload.title, 120) !== item.title) return false;
  if ('price' in authorization.payload && finiteNonNegative(authorization.payload.price) !== item.price) return false;
  return true;
};

const nextBaseline = (previous: CanonicalState, target: CanonicalState, payload: Record<string, unknown>): CanonicalState => ({
  name: 'title' in payload ? target.name : previous.name,
  price: 'price' in payload ? target.price : previous.price,
  stock: previous.stock,
  category: previous.category,
  image: previous.image,
});

export interface MercadoLivreBoundListingUpdateReconciliationResult {
  executionId: string;
  bindingId: string;
  externalItemId: string;
  status: 'reconciled' | 'reconciliation_required';
  snapshotId?: string;
  alreadyReconciled: boolean;
}

export const reconcileMercadoLivreBoundListingUpdate = async (input: {
  storeId: string;
  executionId: string;
  reconciledByUserId: string;
}): Promise<MercadoLivreBoundListingUpdateReconciliationResult> => {
  const storeId = input.storeId.trim();
  const executionId = input.executionId.trim();
  const reconciledByUserId = input.reconciledByUserId.trim();
  if (!storeId || !executionId || reconciledByUserId !== storeId) throw new Error('MERCADO_LIVRE_BOUND_LISTING_UPDATE_RECONCILIATION_TARGET_INVALID');

  const executionRef = adminDb.doc(`stores/${storeId}/catalogOutboundUpdateExecutions/${executionId}`);
  const reconciliationRef = adminDb.doc(`stores/${storeId}/catalogOutboundUpdateReconciliations/${executionId}`);
  const existingReconciliation = await reconciliationRef.get();
  if (existingReconciliation.exists) {
    const existing = existingReconciliation.data() as Record<string, unknown>;
    return {
      executionId,
      bindingId: clean(existing.bindingId, 160),
      externalItemId: clean(existing.externalItemId, 160),
      status: 'reconciled',
      snapshotId: clean(existing.snapshotId, 240),
      alreadyReconciled: true,
    };
  }

  const executionDoc = await executionRef.get();
  if (!executionDoc.exists) throw new Error('MERCADO_LIVRE_BOUND_LISTING_UPDATE_EXECUTION_NOT_FOUND');
  const execution = assertExecution(storeId, executionId, executionDoc.data());
  const authorizationRef = adminDb.doc(`stores/${storeId}/catalogOutboundUpdateAuthorizations/${execution.authorizationId}`);
  const bindingRef = adminDb.doc(`stores/${storeId}/externalCatalogBindings/${execution.bindingId}`);
  const baselineRef = adminDb.doc(`stores/${storeId}/externalCatalogBindingBaselines/${execution.bindingId}`);
  const canonicalRef = adminDb.doc(`stores/${execution.canonicalStoreId}/products/${execution.canonicalProductId}`);
  const proposalRef = adminDb.doc(`stores/${storeId}/catalogOutboundUpdateProposals/${execution.proposalId}`);

  const connection = await getStoreConnectionRegistryRecord({ storeId, connectionId: execution.connectionId });
  if (!connection || connection.provider !== 'mercado_livre' || connection.status !== 'connected' || connection.syncAuthority !== 'manual_review') {
    throw new Error('MERCADO_LIVRE_CONNECTION_INVALID');
  }

  const authorizationDoc = await authorizationRef.get();
  const authorization = assertAuthorization(execution, authorizationDoc.data());
  const fetched = await mercadoLivreGetJson<unknown>(storeId, `/items/${encodeURIComponent(execution.externalItemId)}`);
  const item = providerItem(execution, connection.externalAccountId, fetched);
  if (!providerMatchesAuthorizedTarget(authorization, item)) {
    const checkedAt = new Date().toISOString();
    await adminDb.runTransaction(async transaction => {
      const currentExecutionDoc = await transaction.get(executionRef);
      if (!currentExecutionDoc.exists) throw new Error('MERCADO_LIVRE_BOUND_LISTING_UPDATE_EXECUTION_NOT_FOUND');
      const currentExecution = assertExecution(storeId, executionId, currentExecutionDoc.data());
      transaction.update(executionRef, {
        status: 'reconciliation_required',
        reconciliationCheckStatus: 'provider_target_not_observed',
        lastReconciliationCheckedAt: checkedAt,
        serverLastReconciliationCheckedAt: FieldValue.serverTimestamp(),
      });
      transaction.update(authorizationRef, {
        consumptionStatus: 'reconciliation_required',
        lastReconciliationCheckedAt: checkedAt,
        serverLastReconciliationCheckedAt: FieldValue.serverTimestamp(),
      });
      transaction.update(proposalRef, {
        executionStatus: 'reconciliation_required',
        lastReconciliationCheckedAt: checkedAt,
        serverLastReconciliationCheckedAt: FieldValue.serverTimestamp(),
      });
      void currentExecution;
    });
    return { executionId, bindingId: execution.bindingId, externalItemId: execution.externalItemId, status: 'reconciliation_required', alreadyReconciled: false };
  }

  const fetchedAt = new Date().toISOString();
  const snapshotId = `${executionId}__outbound_update_snapshot`;
  const snapshotRef = adminDb.doc(`stores/${storeId}/externalCatalogSnapshots/${snapshotId}`);

  await adminDb.runTransaction(async transaction => {
    const [currentExecutionDoc, currentAuthorizationDoc, bindingDoc, baselineDoc, canonicalDoc, currentReconciliationDoc, snapshotDoc] = await Promise.all([
      transaction.get(executionRef), transaction.get(authorizationRef), transaction.get(bindingRef), transaction.get(baselineRef),
      transaction.get(canonicalRef), transaction.get(reconciliationRef), transaction.get(snapshotRef),
    ]);
    if (currentReconciliationDoc.exists) return;
    if (!currentExecutionDoc.exists) throw new Error('MERCADO_LIVRE_BOUND_LISTING_UPDATE_EXECUTION_NOT_FOUND');
    const currentExecution = assertExecution(storeId, executionId, currentExecutionDoc.data());
    const currentAuthorization = assertAuthorization(currentExecution, currentAuthorizationDoc.data());
    const binding = assertBinding(currentExecution, bindingDoc.data());
    const previousBaseline = assertBaseline(currentExecution, binding, baselineDoc.data()).baseline;
    const target = canonicalState(currentExecution, canonicalDoc.data());
    if (baselineHash(target) !== currentExecution.canonicalTargetHash) throw new Error('MERCADO_LIVRE_BOUND_LISTING_UPDATE_RECONCILIATION_STALE');
    if (!providerMatchesAuthorizedTarget(currentAuthorization, item)) throw new Error('MERCADO_LIVRE_BOUND_LISTING_UPDATE_PROVIDER_STALE');

    const advancedBaseline = nextBaseline(previousBaseline, target, currentAuthorization.payload);
    const advancedBaselineHash = baselineHash(advancedBaseline);
    const snapshot = {
      id: snapshotId,
      provider: 'mercado_livre',
      storeId,
      connectionId: execution.connectionId,
      externalAccountId: connection.externalAccountId,
      externalItemId: execution.externalItemId,
      sourceNotificationId: `outbound_update:${executionId}`,
      sourceTopic: 'items',
      sourceResource: `/items/${execution.externalItemId}`,
      sourceExecutionId: executionId,
      authority: 'provider_api_refetch',
      fetchedAt,
      item,
    };

    if (snapshotDoc.exists) {
      const existing = snapshotDoc.data() as Record<string, unknown>;
      if (clean(existing.externalItemId, 160) !== execution.externalItemId || existing.authority !== 'provider_api_refetch') {
        throw new Error('MERCADO_LIVRE_EXTERNAL_SNAPSHOT_CONFLICT');
      }
    } else {
      transaction.create(snapshotRef, { ...snapshot, serverCreatedAt: FieldValue.serverTimestamp() });
    }

    transaction.set(baselineRef, {
      schemaVersion: 1,
      id: execution.bindingId,
      storeId,
      bindingId: execution.bindingId,
      canonicalStoreId: execution.canonicalStoreId,
      canonicalProductId: execution.canonicalProductId,
      baselineHash: advancedBaselineHash,
      baseline: advancedBaseline,
      authority: 'provider_api_refetch_outbound_update',
      capturedByUserId: reconciledByUserId,
      capturedAt: fetchedAt,
      sourceExecutionId: executionId,
      sourceSnapshotId: snapshotId,
      serverUpdatedAt: FieldValue.serverTimestamp(),
    });
    transaction.update(bindingRef, {
      canonicalBaselineHash: advancedBaselineHash,
      sourceLastSyncedAt: fetchedAt,
      lastOutboundUpdateExecutionId: executionId,
      lastOutboundUpdateSnapshotId: snapshotId,
      updatedAt: fetchedAt,
      serverUpdatedAt: FieldValue.serverTimestamp(),
    });
    transaction.update(executionRef, {
      status: 'reconciled',
      reconciliationStatus: 'reconciled',
      reconciliationSnapshotId: snapshotId,
      reconciledAt: fetchedAt,
      serverReconciledAt: FieldValue.serverTimestamp(),
    });
    transaction.update(authorizationRef, {
      consumptionStatus: 'consumed',
      reconciledAt: fetchedAt,
      serverReconciledAt: FieldValue.serverTimestamp(),
    });
    transaction.update(proposalRef, {
      executionStatus: 'reconciled',
      reconciliationSnapshotId: snapshotId,
      reconciledAt: fetchedAt,
      serverReconciledAt: FieldValue.serverTimestamp(),
    });
    transaction.create(reconciliationRef, {
      schemaVersion: 1,
      id: executionId,
      storeId,
      provider: 'mercado_livre',
      executionId,
      authorizationId: execution.authorizationId,
      proposalId: execution.proposalId,
      bindingId: execution.bindingId,
      connectionId: execution.connectionId,
      canonicalStoreId: execution.canonicalStoreId,
      canonicalProductId: execution.canonicalProductId,
      externalItemId: execution.externalItemId,
      snapshotId,
      previousBaselineHash: execution.canonicalBaselineHash,
      canonicalTargetHash: execution.canonicalTargetHash,
      reconciledBaselineHash: advancedBaselineHash,
      reconciledFields: Object.keys(currentAuthorization.payload).map(key => key === 'title' ? 'name' : key),
      protectedBaselineFieldsPreserved: ['stock', 'category', 'image'],
      providerIdentityVerified: true,
      providerSellerId: connection.externalAccountId,
      authority: 'provider_api_refetch_outbound_update',
      reconciledByUserId,
      reconciledAt: fetchedAt,
      serverReconciledAt: FieldValue.serverTimestamp(),
    });
  });

  return { executionId, bindingId: execution.bindingId, externalItemId: execution.externalItemId, status: 'reconciled', snapshotId, alreadyReconciled: false };
};
