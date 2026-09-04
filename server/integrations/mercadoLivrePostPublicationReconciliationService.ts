import { createHash } from 'node:crypto';
import { FieldValue } from 'firebase-admin/firestore';
import { adminDb } from '../firebaseAdmin.js';
import { mercadoLivreGetJson } from './mercadoLivreOauthService.js';
import { getStoreConnectionRegistryRecord } from './storeConnectionRegistry.js';
import { assertMercadoLivrePublicationCapabilitySnapshot } from './mercadoLivrePublicationCapabilitySnapshotGuard.js';
import { recoverAmbiguousMercadoLivrePublication } from './mercadoLivreAmbiguousPublicationRecoveryService.js';

interface ExecutionRecord {
  schemaVersion: 2;
  id: string;
  proposalId: string;
  authorizationId: string;
  storeId: string;
  provider: 'mercado_livre';
  connectionId: string;
  canonicalStoreId: string;
  canonicalProductId: string;
  providerCapabilityFingerprint: string;
  providerPublicationModel: 'legacy_items' | 'user_products';
  providerStockAuthority: 'item_available_quantity';
  providerCapability: unknown;
  status: 'published';
  externalItemId: string;
  externalUserProductId?: string;
  bindingId: string;
}

interface AuthorizationRecord {
  schemaVersion: 2;
  id: string;
  proposalId: string;
  storeId: string;
  provider: 'mercado_livre';
  connectionId: string;
  canonicalStoreId: string;
  canonicalProductId: string;
  canonicalBaselineHash: string;
  providerCapabilityFingerprint: string;
  providerPublicationModel: 'legacy_items' | 'user_products';
  providerStockAuthority: 'item_available_quantity';
  providerCapability: unknown;
  consumptionStatus: 'consumed';
  externalItemId: string;
  externalUserProductId?: string;
  bindingId: string;
}

interface BindingRecord {
  schemaVersion: 2;
  id: string;
  storeId: string;
  provider: 'mercado_livre';
  connectionId: string;
  externalItemId: string;
  externalUserProductId?: string;
  canonicalStoreId: string;
  canonicalProductId: string;
  status: 'active';
  canonicalBaselineHash: string;
  providerCapabilityFingerprint: string;
  providerPublicationModel: 'legacy_items' | 'user_products';
  providerStockAuthority: 'item_available_quantity';
}

interface CanonicalState {
  name: string;
  price: number;
  stock: number;
  category: string;
  image: string;
}

interface ProviderItem {
  id?: unknown;
  user_product_id?: unknown;
  title?: unknown;
  price?: unknown;
  available_quantity?: unknown;
  status?: unknown;
  category_id?: unknown;
  seller_custom_field?: unknown;
  seller_id?: unknown;
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

const syncBaselineHash = (state: CanonicalState): string => sha256(JSON.stringify({
  ...state,
  isService: false,
}));

const assertCapabilityBinding = (record: Record<string, unknown>, errorCode: string): void => {
  const snapshot = assertMercadoLivrePublicationCapabilitySnapshot(record.providerCapability);
  if (
    clean(record.providerCapabilityFingerprint, 80) !== snapshot.fingerprint ||
    record.providerPublicationModel !== snapshot.publicationModel ||
    record.providerStockAuthority !== 'item_available_quantity' ||
    record.providerStockAuthority !== snapshot.stockAuthority
  ) throw new Error(errorCode);
};

const assertExecution = (storeId: string, executionId: string, value: unknown): ExecutionRecord => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('MERCADO_LIVRE_PUBLICATION_EXECUTION_NOT_FOUND');
  const record = value as Record<string, unknown>;
  if (
    record.schemaVersion !== 2 ||
    clean(record.id, 160) !== executionId || clean(record.storeId, 160) !== storeId ||
    record.provider !== 'mercado_livre' || record.status !== 'published' ||
    !clean(record.proposalId, 160) || !clean(record.authorizationId, 160) ||
    !clean(record.connectionId, 200) || !clean(record.canonicalStoreId, 160) ||
    !clean(record.canonicalProductId, 160) || !clean(record.externalItemId, 160) || !clean(record.bindingId, 160) ||
    !clean(record.providerCapabilityFingerprint, 80) ||
    (record.providerPublicationModel !== 'legacy_items' && record.providerPublicationModel !== 'user_products') ||
    record.providerStockAuthority !== 'item_available_quantity' || !record.providerCapability ||
    (record.providerPublicationModel === 'user_products' && !clean(record.externalUserProductId, 160))
  ) throw new Error('MERCADO_LIVRE_PUBLICATION_EXECUTION_NOT_RECONCILABLE');
  assertCapabilityBinding(record, 'MERCADO_LIVRE_PUBLICATION_EXECUTION_NOT_RECONCILABLE');
  return record as unknown as ExecutionRecord;
};

const assertAuthorization = (execution: ExecutionRecord, value: unknown): AuthorizationRecord => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('MERCADO_LIVRE_PUBLICATION_AUTHORIZATION_NOT_FOUND');
  const record = value as Record<string, unknown>;
  if (
    record.schemaVersion !== 2 ||
    clean(record.id, 160) !== execution.authorizationId || clean(record.proposalId, 160) !== execution.proposalId ||
    clean(record.storeId, 160) !== execution.storeId || record.provider !== 'mercado_livre' ||
    clean(record.connectionId, 200) !== execution.connectionId || clean(record.canonicalStoreId, 160) !== execution.canonicalStoreId ||
    clean(record.canonicalProductId, 160) !== execution.canonicalProductId || !clean(record.canonicalBaselineHash, 80) ||
    record.consumptionStatus !== 'consumed' || clean(record.externalItemId, 160) !== execution.externalItemId ||
    clean(record.bindingId, 160) !== execution.bindingId ||
    clean(record.providerCapabilityFingerprint, 80) !== execution.providerCapabilityFingerprint ||
    record.providerPublicationModel !== execution.providerPublicationModel ||
    record.providerStockAuthority !== execution.providerStockAuthority || !record.providerCapability ||
    (execution.providerPublicationModel === 'user_products' &&
      clean(record.externalUserProductId, 160) !== execution.externalUserProductId)
  ) throw new Error('MERCADO_LIVRE_PUBLICATION_AUTHORIZATION_STALE');
  assertCapabilityBinding(record, 'MERCADO_LIVRE_PUBLICATION_AUTHORIZATION_STALE');
  return record as unknown as AuthorizationRecord;
};

const assertBinding = (execution: ExecutionRecord, value: unknown): BindingRecord => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('MERCADO_LIVRE_EXTERNAL_BINDING_NOT_FOUND');
  const record = value as Record<string, unknown>;
  if (
    record.schemaVersion !== 2 ||
    clean(record.id, 160) !== execution.bindingId || clean(record.storeId, 160) !== execution.storeId ||
    record.provider !== 'mercado_livre' || record.status !== 'active' ||
    clean(record.connectionId, 200) !== execution.connectionId || clean(record.externalItemId, 160) !== execution.externalItemId ||
    clean(record.canonicalStoreId, 160) !== execution.canonicalStoreId || clean(record.canonicalProductId, 160) !== execution.canonicalProductId ||
    !clean(record.canonicalBaselineHash, 80) ||
    clean(record.providerCapabilityFingerprint, 80) !== execution.providerCapabilityFingerprint ||
    record.providerPublicationModel !== execution.providerPublicationModel ||
    record.providerStockAuthority !== execution.providerStockAuthority ||
    (execution.providerPublicationModel === 'user_products' &&
      clean(record.externalUserProductId, 160) !== execution.externalUserProductId)
  ) throw new Error('MERCADO_LIVRE_EXTERNAL_BINDING_CONFLICT');
  return record as unknown as BindingRecord;
};

const canonicalState = (execution: ExecutionRecord, value: unknown): CanonicalState => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('MERCADO_LIVRE_BOUND_CANONICAL_PRODUCT_NOT_FOUND');
  const record = value as Record<string, unknown>;
  const price = finiteNonNegative(record.price);
  const stock = integerNonNegative(record.stock);
  const name = clean(record.name, 120);
  const category = clean(record.category, 120);
  if (
    clean(record.id, 160) !== execution.canonicalProductId || clean(record.storeId, 160) !== execution.canonicalStoreId ||
    !name || price === null || stock === null || !category || record.isService !== false
  ) throw new Error('MERCADO_LIVRE_BOUND_CANONICAL_PRODUCT_INVALID');
  return { name, price, stock, category, image: clean(record.image, 2_000) };
};

const providerItem = (value: unknown, execution: ExecutionRecord, externalAccountId: string) => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('MERCADO_LIVRE_ITEM_RESPONSE_INVALID');
  const item = value as ProviderItem;
  const id = clean(item.id, 160);
  const externalUserProductId = clean(item.user_product_id, 160);
  const title = clean(item.title, 120);
  const sellerId = clean(item.seller_id, 160);
  if (
    id !== execution.externalItemId || !title || sellerId !== externalAccountId ||
    (execution.providerPublicationModel === 'user_products' &&
      externalUserProductId !== execution.externalUserProductId)
  ) {
    throw new Error('MERCADO_LIVRE_POST_PUBLICATION_IDENTITY_MISMATCH');
  }
  return {
    externalId: id,
    ...(externalUserProductId ? { externalUserProductId } : {}),
    title,
    price: finiteNonNegative(item.price),
    availableQuantity: finiteNonNegative(item.available_quantity),
    status: clean(item.status, 80),
    categoryId: clean(item.category_id, 160),
    ...(clean(item.seller_custom_field, 240) ? { sellerSku: clean(item.seller_custom_field, 240) } : {}),
  };
};

export interface MercadoLivrePostPublicationReconciliationResult {
  executionId: string;
  bindingId: string;
  externalItemId: string;
  externalUserProductId?: string;
  providerPublicationModel: 'legacy_items' | 'user_products';
  snapshotId: string;
  reconciliationStatus: 'reconciled';
  alreadyReconciled: boolean;
  recoveredFromAmbiguousExecution?: boolean;
}

export const reconcileMercadoLivrePublishedItem = async (input: {
  storeId: string;
  executionId: string;
  reconciledByUserId: string;
}): Promise<MercadoLivrePostPublicationReconciliationResult> => {
  const storeId = input.storeId.trim();
  const executionId = input.executionId.trim();
  const reconciledByUserId = input.reconciledByUserId.trim();
  if (!storeId || !executionId || reconciledByUserId !== storeId) {
    throw new Error('MERCADO_LIVRE_POST_PUBLICATION_RECONCILIATION_TARGET_INVALID');
  }

  const executionRef = adminDb.doc(`stores/${storeId}/catalogOutboundPublicationExecutions/${executionId}`);
  let executionDoc = await executionRef.get();
  if (!executionDoc.exists) throw new Error('MERCADO_LIVRE_PUBLICATION_EXECUTION_NOT_FOUND');
  const initialExecution = executionDoc.data() as Record<string, unknown>;
  const recoveredFromAmbiguousExecution = clean(initialExecution.status, 80) === 'reconciliation_required';
  if (recoveredFromAmbiguousExecution) {
    await recoverAmbiguousMercadoLivrePublication({
      storeId,
      executionId,
      recoveredByUserId: reconciledByUserId,
    });
    executionDoc = await executionRef.get();
  }

  const execution = assertExecution(storeId, executionId, executionDoc.data());
  const authorizationRef = adminDb.doc(`stores/${storeId}/catalogOutboundPublicationAuthorizations/${execution.authorizationId}`);
  const bindingRef = adminDb.doc(`stores/${storeId}/externalCatalogBindings/${execution.bindingId}`);
  const canonicalRef = adminDb.doc(`stores/${execution.canonicalStoreId}/products/${execution.canonicalProductId}`);
  const proposalRef = adminDb.doc(`stores/${storeId}/catalogOutboundPublicationProposals/${execution.proposalId}`);
  const reconciliationRef = adminDb.doc(`stores/${storeId}/catalogOutboundPublicationReconciliations/${executionId}`);
  const snapshotId = `${executionId}__initial_snapshot`;
  const snapshotRef = adminDb.doc(`stores/${storeId}/externalCatalogSnapshots/${snapshotId}`);
  const baselineRef = adminDb.doc(`stores/${storeId}/externalCatalogBindingBaselines/${execution.bindingId}`);

  const existingReconciliation = await reconciliationRef.get();
  if (existingReconciliation.exists) {
    return {
      executionId,
      bindingId: execution.bindingId,
      externalItemId: execution.externalItemId,
      ...(execution.externalUserProductId ? { externalUserProductId: execution.externalUserProductId } : {}),
      providerPublicationModel: execution.providerPublicationModel,
      snapshotId,
      reconciliationStatus: 'reconciled',
      alreadyReconciled: true,
      ...(recoveredFromAmbiguousExecution ? { recoveredFromAmbiguousExecution: true } : {}),
    };
  }

  const connection = await getStoreConnectionRegistryRecord({ storeId, connectionId: execution.connectionId });
  if (!connection || connection.provider !== 'mercado_livre' || connection.status !== 'connected' || connection.syncAuthority !== 'manual_review') {
    throw new Error('MERCADO_LIVRE_CONNECTION_INVALID');
  }

  const fetched = await mercadoLivreGetJson<unknown>(storeId, `/items/${encodeURIComponent(execution.externalItemId)}`);
  const item = providerItem(fetched, execution, connection.externalAccountId);
  const fetchedAt = new Date().toISOString();

  await adminDb.runTransaction(async transaction => {
    const [currentExecutionDoc, authorizationDoc, bindingDoc, canonicalDoc, currentReconciliationDoc, snapshotDoc, baselineDoc] = await Promise.all([
      transaction.get(executionRef), transaction.get(authorizationRef), transaction.get(bindingRef), transaction.get(canonicalRef),
      transaction.get(reconciliationRef), transaction.get(snapshotRef), transaction.get(baselineRef),
    ]);
    if (currentReconciliationDoc.exists) return;
    if (!currentExecutionDoc.exists) throw new Error('MERCADO_LIVRE_PUBLICATION_EXECUTION_NOT_FOUND');
    const currentExecution = assertExecution(storeId, executionId, currentExecutionDoc.data());
    const authorization = assertAuthorization(currentExecution, authorizationDoc.data());
    const binding = assertBinding(currentExecution, bindingDoc.data());
    const canonical = canonicalState(currentExecution, canonicalDoc.data());
    const inboundBaselineHash = syncBaselineHash(canonical);

    if (binding.canonicalBaselineHash !== authorization.canonicalBaselineHash && binding.canonicalBaselineHash !== inboundBaselineHash) {
      throw new Error('MERCADO_LIVRE_POST_PUBLICATION_BASELINE_CONFLICT');
    }

    const snapshot = {
      id: snapshotId,
      provider: 'mercado_livre',
      storeId,
      connectionId: execution.connectionId,
      externalAccountId: connection.externalAccountId,
      externalItemId: execution.externalItemId,
      ...(execution.externalUserProductId ? { externalUserProductId: execution.externalUserProductId } : {}),
      providerCapabilityFingerprint: execution.providerCapabilityFingerprint,
      providerPublicationModel: execution.providerPublicationModel,
      providerStockAuthority: execution.providerStockAuthority,
      sourceNotificationId: `outbound_publication:${executionId}`,
      sourceTopic: 'items',
      sourceResource: `/items/${execution.externalItemId}`,
      sourceExecutionId: executionId,
      authority: 'provider_api_refetch',
      fetchedAt,
      item,
    };

    if (snapshotDoc.exists) {
      const existing = snapshotDoc.data() as Record<string, unknown>;
      if (
        clean(existing.externalItemId, 160) !== execution.externalItemId || existing.authority !== 'provider_api_refetch' ||
        existing.providerPublicationModel !== execution.providerPublicationModel ||
        (execution.providerPublicationModel === 'user_products' &&
          clean(existing.externalUserProductId, 160) !== execution.externalUserProductId)
      ) {
        throw new Error('MERCADO_LIVRE_EXTERNAL_SNAPSHOT_CONFLICT');
      }
    } else {
      transaction.create(snapshotRef, { ...snapshot, serverCreatedAt: FieldValue.serverTimestamp() });
    }

    if (baselineDoc.exists) {
      const existing = baselineDoc.data() as Record<string, unknown>;
      if (clean(existing.baselineHash, 80) !== inboundBaselineHash) {
        throw new Error('MERCADO_LIVRE_POST_PUBLICATION_BASELINE_CONFLICT');
      }
    } else {
      transaction.create(baselineRef, {
        schemaVersion: 1,
        id: execution.bindingId,
        storeId,
        bindingId: execution.bindingId,
        canonicalStoreId: execution.canonicalStoreId,
        canonicalProductId: execution.canonicalProductId,
        baselineHash: inboundBaselineHash,
        baseline: canonical,
        authority: 'post_publication_canonical_snapshot',
        capturedByUserId: reconciledByUserId,
        capturedAt: fetchedAt,
        serverCreatedAt: FieldValue.serverTimestamp(),
      });
    }

    transaction.update(bindingRef, {
      canonicalBaselineHash: inboundBaselineHash,
      sourceLastSyncedAt: fetchedAt,
      initialExternalSnapshotId: snapshotId,
      reconciliationStatus: 'reconciled',
      reconciledAt: fetchedAt,
      updatedAt: fetchedAt,
      serverUpdatedAt: FieldValue.serverTimestamp(),
    });
    transaction.update(executionRef, {
      reconciliationStatus: 'reconciled',
      reconciliationSnapshotId: snapshotId,
      reconciledAt: fetchedAt,
      serverReconciledAt: FieldValue.serverTimestamp(),
    });
    transaction.update(proposalRef, {
      postPublicationReconciliationStatus: 'reconciled',
      initialExternalSnapshotId: snapshotId,
      postPublicationReconciledAt: fetchedAt,
      serverPostPublicationReconciledAt: FieldValue.serverTimestamp(),
    });
    transaction.create(reconciliationRef, {
      schemaVersion: 2,
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
      ...(execution.externalUserProductId ? { externalUserProductId: execution.externalUserProductId } : {}),
      providerCapabilityFingerprint: execution.providerCapabilityFingerprint,
      providerPublicationModel: execution.providerPublicationModel,
      providerStockAuthority: execution.providerStockAuthority,
      snapshotId,
      providerIdentityVerified: true,
      providerSellerId: connection.externalAccountId,
      canonicalBaselineHash: inboundBaselineHash,
      authority: 'provider_api_refetch_post_publication',
      reconciledByUserId,
      reconciledAt: fetchedAt,
      ...(recoveredFromAmbiguousExecution ? { recoveredFromAmbiguousExecution: true } : {}),
      serverReconciledAt: FieldValue.serverTimestamp(),
    });
  });

  return {
    executionId,
    bindingId: execution.bindingId,
    externalItemId: execution.externalItemId,
    ...(execution.externalUserProductId ? { externalUserProductId: execution.externalUserProductId } : {}),
    providerPublicationModel: execution.providerPublicationModel,
    snapshotId,
    reconciliationStatus: 'reconciled',
    alreadyReconciled: false,
    ...(recoveredFromAmbiguousExecution ? { recoveredFromAmbiguousExecution: true } : {}),
  };
};
