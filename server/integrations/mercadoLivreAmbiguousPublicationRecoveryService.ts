import { createHash } from 'node:crypto';
import { FieldValue } from 'firebase-admin/firestore';
import { adminDb } from '../firebaseAdmin.js';
import { mercadoLivreGetJson } from './mercadoLivreOauthService.js';
import { getStoreConnectionRegistryRecord } from './storeConnectionRegistry.js';
import { assertMercadoLivrePublicationCapabilitySnapshot } from './mercadoLivrePublicationCapabilitySnapshotGuard.js';
import { assertMercadoLivrePublicationCorrelationMarker } from './mercadoLivrePublicationCorrelation.js';

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
  status: 'reconciliation_required';
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
  payload: Record<string, unknown>;
  consumptionStatus: 'reconciliation_required';
}

interface SearchResponse {
  seller_id?: unknown;
  results?: unknown;
}

interface ProviderItem {
  id?: unknown;
  user_product_id?: unknown;
  seller_id?: unknown;
  seller_custom_field?: unknown;
  status?: unknown;
  permalink?: unknown;
}

const clean = (value: unknown, maximum = 2_000): string =>
  typeof value === 'string' || typeof value === 'number'
    ? String(value).replace(/\s+/g, ' ').trim().slice(0, maximum)
    : '';

const sha256 = (value: string): string => createHash('sha256').update(value).digest('hex');

const deterministicBindingId = (
  storeId: string,
  connectionId: string,
  externalItemId: string
): string => `mlbind_${sha256([storeId, 'mercado_livre', connectionId, externalItemId].join(':')).slice(0, 32)}`;

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
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('MERCADO_LIVRE_PUBLICATION_EXECUTION_NOT_FOUND');
  }
  const record = value as Record<string, unknown>;
  if (
    record.schemaVersion !== 2 ||
    clean(record.id, 160) !== executionId || clean(record.storeId, 160) !== storeId ||
    record.provider !== 'mercado_livre' || record.status !== 'reconciliation_required' ||
    !clean(record.proposalId, 160) || !clean(record.authorizationId, 160) ||
    !clean(record.connectionId, 200) || !clean(record.canonicalStoreId, 160) || !clean(record.canonicalProductId, 160) ||
    !clean(record.providerCapabilityFingerprint, 80) ||
    (record.providerPublicationModel !== 'legacy_items' && record.providerPublicationModel !== 'user_products') ||
    record.providerStockAuthority !== 'item_available_quantity' || !record.providerCapability
  ) throw new Error('MERCADO_LIVRE_PUBLICATION_EXECUTION_NOT_RECOVERABLE');
  assertCapabilityBinding(record, 'MERCADO_LIVRE_PUBLICATION_EXECUTION_NOT_RECOVERABLE');
  return record as unknown as ExecutionRecord;
};

const assertAuthorization = (execution: ExecutionRecord, value: unknown): AuthorizationRecord => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('MERCADO_LIVRE_PUBLICATION_AUTHORIZATION_NOT_FOUND');
  }
  const record = value as Record<string, unknown>;
  if (
    record.schemaVersion !== 2 ||
    clean(record.id, 160) !== execution.authorizationId || clean(record.proposalId, 160) !== execution.proposalId ||
    clean(record.storeId, 160) !== execution.storeId || record.provider !== 'mercado_livre' ||
    clean(record.connectionId, 200) !== execution.connectionId ||
    clean(record.canonicalStoreId, 160) !== execution.canonicalStoreId ||
    clean(record.canonicalProductId, 160) !== execution.canonicalProductId ||
    !clean(record.canonicalBaselineHash, 80) ||
    clean(record.providerCapabilityFingerprint, 80) !== execution.providerCapabilityFingerprint ||
    record.providerPublicationModel !== execution.providerPublicationModel ||
    record.providerStockAuthority !== execution.providerStockAuthority || !record.providerCapability ||
    !record.payload || typeof record.payload !== 'object' || Array.isArray(record.payload) ||
    record.consumptionStatus !== 'reconciliation_required'
  ) throw new Error('MERCADO_LIVRE_PUBLICATION_AUTHORIZATION_STALE');
  assertCapabilityBinding(record, 'MERCADO_LIVRE_PUBLICATION_AUTHORIZATION_STALE');
  return record as unknown as AuthorizationRecord;
};

const candidateIds = (value: unknown, externalAccountId: string): string[] => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('MERCADO_LIVRE_PUBLICATION_RECOVERY_SEARCH_INVALID');
  }
  const response = value as SearchResponse;
  if (clean(response.seller_id, 160) !== externalAccountId || !Array.isArray(response.results)) {
    throw new Error('MERCADO_LIVRE_PUBLICATION_RECOVERY_SEARCH_INVALID');
  }
  return response.results.map(item => clean(item, 160)).filter(Boolean);
};

const verifyCandidate = (
  value: unknown,
  candidateId: string,
  marker: string,
  externalAccountId: string,
  publicationModel: 'legacy_items' | 'user_products'
): { externalItemId: string; externalUserProductId?: string; providerStatus: string; permalink?: string } => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('MERCADO_LIVRE_ITEM_RESPONSE_INVALID');
  }
  const item = value as ProviderItem;
  const externalItemId = clean(item.id, 160);
  const externalUserProductId = clean(item.user_product_id, 160);
  const sellerId = clean(item.seller_id, 160);
  const sellerCustomField = clean(item.seller_custom_field, 240);
  if (
    externalItemId !== candidateId || sellerId !== externalAccountId || sellerCustomField !== marker ||
    (publicationModel === 'user_products' && !externalUserProductId)
  ) {
    throw new Error('MERCADO_LIVRE_PUBLICATION_RECOVERY_IDENTITY_MISMATCH');
  }
  const permalink = clean(item.permalink, 2_000);
  return {
    externalItemId,
    ...(externalUserProductId ? { externalUserProductId } : {}),
    providerStatus: clean(item.status, 80),
    ...(permalink ? { permalink } : {}),
  };
};

export interface MercadoLivreAmbiguousPublicationRecoveryResult {
  executionId: string;
  proposalId: string;
  authorizationId: string;
  status: 'published';
  recoveryStatus: 'recovered_from_provider_search';
  externalItemId: string;
  externalUserProductId?: string;
  bindingId: string;
  providerStatus: string;
  providerPublicationModel: 'legacy_items' | 'user_products';
  permalink?: string;
}

export const recoverAmbiguousMercadoLivrePublication = async (input: {
  storeId: string;
  executionId: string;
  recoveredByUserId: string;
}): Promise<MercadoLivreAmbiguousPublicationRecoveryResult> => {
  const storeId = input.storeId.trim();
  const executionId = input.executionId.trim();
  const recoveredByUserId = input.recoveredByUserId.trim();
  if (!storeId || !executionId || recoveredByUserId !== storeId) {
    throw new Error('MERCADO_LIVRE_PUBLICATION_RECOVERY_TARGET_INVALID');
  }

  const executionRef = adminDb.doc(`stores/${storeId}/catalogOutboundPublicationExecutions/${executionId}`);
  const executionDoc = await executionRef.get();
  if (!executionDoc.exists) throw new Error('MERCADO_LIVRE_PUBLICATION_EXECUTION_NOT_FOUND');
  const execution = assertExecution(storeId, executionId, executionDoc.data());
  const authorizationRef = adminDb.doc(`stores/${storeId}/catalogOutboundPublicationAuthorizations/${execution.authorizationId}`);
  const authorizationDoc = await authorizationRef.get();
  const authorization = assertAuthorization(execution, authorizationDoc.data());
  const marker = assertMercadoLivrePublicationCorrelationMarker(authorization.payload.seller_custom_field);

  const connection = await getStoreConnectionRegistryRecord({ storeId, connectionId: execution.connectionId });
  if (!connection || connection.provider !== 'mercado_livre' || connection.status !== 'connected' || connection.syncAuthority !== 'manual_review') {
    throw new Error('MERCADO_LIVRE_CONNECTION_INVALID');
  }

  const search = await mercadoLivreGetJson<unknown>(
    storeId,
    `/users/${encodeURIComponent(connection.externalAccountId)}/items/search?sku=${encodeURIComponent(marker)}`
  );
  const candidates = candidateIds(search, connection.externalAccountId);
  if (candidates.length === 0) throw new Error('MERCADO_LIVRE_PUBLICATION_RECOVERY_NOT_FOUND_REVIEW_REQUIRED');
  if (candidates.length !== 1) throw new Error('MERCADO_LIVRE_PUBLICATION_RECOVERY_MULTIPLE_CANDIDATES');

  const candidate = await mercadoLivreGetJson<unknown>(storeId, `/items/${encodeURIComponent(candidates[0])}`);
  const verified = verifyCandidate(
    candidate,
    candidates[0],
    marker,
    connection.externalAccountId,
    execution.providerPublicationModel
  );
  const bindingId = deterministicBindingId(storeId, execution.connectionId, verified.externalItemId);
  const bindingRef = adminDb.doc(`stores/${storeId}/externalCatalogBindings/${bindingId}`);
  const proposalRef = adminDb.doc(`stores/${storeId}/catalogOutboundPublicationProposals/${execution.proposalId}`);
  const recoveryRef = adminDb.doc(`stores/${storeId}/catalogOutboundPublicationRecoveries/${executionId}`);
  const recoveredAt = new Date().toISOString();

  await adminDb.runTransaction(async transaction => {
    const [currentExecutionDoc, currentAuthorizationDoc, proposalDoc, bindingDoc, recoveryDoc] = await Promise.all([
      transaction.get(executionRef),
      transaction.get(authorizationRef),
      transaction.get(proposalRef),
      transaction.get(bindingRef),
      transaction.get(recoveryRef),
    ]);
    if (recoveryDoc.exists) throw new Error('MERCADO_LIVRE_PUBLICATION_RECOVERY_ALREADY_RECORDED');
    if (!currentExecutionDoc.exists) throw new Error('MERCADO_LIVRE_PUBLICATION_EXECUTION_NOT_FOUND');
    const currentExecution = assertExecution(storeId, executionId, currentExecutionDoc.data());
    const currentAuthorization = assertAuthorization(currentExecution, currentAuthorizationDoc.data());
    const proposal = proposalDoc.data() as Record<string, unknown> | undefined;
    if (
      clean(proposal?.id, 160) !== currentExecution.proposalId ||
      clean(proposal?.publicationExecutionId, 160) !== executionId ||
      clean(proposal?.executionStatus, 80) !== 'reconciliation_required' ||
      clean(proposal?.providerCapabilityFingerprint, 80) !== currentExecution.providerCapabilityFingerprint ||
      proposal?.providerPublicationModel !== currentExecution.providerPublicationModel ||
      proposal?.providerStockAuthority !== currentExecution.providerStockAuthority ||
      assertMercadoLivrePublicationCorrelationMarker(currentAuthorization.payload.seller_custom_field) !== marker
    ) throw new Error('MERCADO_LIVRE_PUBLICATION_RECOVERY_STALE');

    if (bindingDoc.exists) {
      const existing = bindingDoc.data() as Record<string, unknown>;
      if (
        existing.provider !== 'mercado_livre' || clean(existing.storeId, 160) !== storeId ||
        clean(existing.connectionId, 200) !== currentExecution.connectionId ||
        clean(existing.externalItemId, 160) !== verified.externalItemId ||
        clean(existing.canonicalStoreId, 160) !== currentExecution.canonicalStoreId ||
        clean(existing.canonicalProductId, 160) !== currentExecution.canonicalProductId ||
        clean(existing.providerCapabilityFingerprint, 80) !== currentExecution.providerCapabilityFingerprint ||
        existing.providerPublicationModel !== currentExecution.providerPublicationModel ||
        existing.providerStockAuthority !== currentExecution.providerStockAuthority ||
        (currentExecution.providerPublicationModel === 'user_products' &&
          clean(existing.externalUserProductId, 160) !== verified.externalUserProductId)
      ) throw new Error('MERCADO_LIVRE_EXTERNAL_BINDING_CONFLICT');
    } else {
      transaction.create(bindingRef, {
        schemaVersion: 2,
        id: bindingId,
        storeId,
        provider: 'mercado_livre',
        connectionId: currentExecution.connectionId,
        externalItemId: verified.externalItemId,
        ...(verified.externalUserProductId ? { externalUserProductId: verified.externalUserProductId } : {}),
        canonicalStoreId: currentExecution.canonicalStoreId,
        canonicalProductId: currentExecution.canonicalProductId,
        status: 'active',
        authority: 'provider_search_recovered_owner_publication',
        boundByUserId: recoveredByUserId,
        sourceProposalId: currentExecution.proposalId,
        sourceAuthorizationId: currentExecution.authorizationId,
        sourceExecutionId: executionId,
        canonicalBaselineHash: currentAuthorization.canonicalBaselineHash,
        providerCapabilityFingerprint: currentExecution.providerCapabilityFingerprint,
        providerPublicationModel: currentExecution.providerPublicationModel,
        providerStockAuthority: currentExecution.providerStockAuthority,
        createdAt: recoveredAt,
        updatedAt: recoveredAt,
        serverCreatedAt: FieldValue.serverTimestamp(),
        serverUpdatedAt: FieldValue.serverTimestamp(),
      });
    }

    transaction.update(executionRef, {
      status: 'published',
      recoveryStatus: 'recovered_from_provider_search',
      recoveryCorrelationMarker: marker,
      externalItemId: verified.externalItemId,
      ...(verified.externalUserProductId ? { externalUserProductId: verified.externalUserProductId } : {}),
      bindingId,
      providerStatus: verified.providerStatus,
      ...(verified.permalink ? { permalink: verified.permalink } : {}),
      completedAt: recoveredAt,
      recoveredAt,
      serverRecoveredAt: FieldValue.serverTimestamp(),
    });
    transaction.update(authorizationRef, {
      consumptionStatus: 'consumed',
      consumedAt: recoveredAt,
      externalItemId: verified.externalItemId,
      ...(verified.externalUserProductId ? { externalUserProductId: verified.externalUserProductId } : {}),
      bindingId,
      recoveryStatus: 'recovered_from_provider_search',
      serverConsumedAt: FieldValue.serverTimestamp(),
    });
    transaction.update(proposalRef, {
      executionStatus: 'published',
      externalItemId: verified.externalItemId,
      ...(verified.externalUserProductId ? { externalUserProductId: verified.externalUserProductId } : {}),
      externalCatalogBindingId: bindingId,
      publicationRecoveryStatus: 'recovered_from_provider_search',
      publishedAt: recoveredAt,
      serverPublishedAt: FieldValue.serverTimestamp(),
    });
    transaction.create(recoveryRef, {
      schemaVersion: 2,
      id: executionId,
      storeId,
      provider: 'mercado_livre',
      executionId,
      proposalId: currentExecution.proposalId,
      authorizationId: currentExecution.authorizationId,
      connectionId: currentExecution.connectionId,
      canonicalStoreId: currentExecution.canonicalStoreId,
      canonicalProductId: currentExecution.canonicalProductId,
      correlationMarker: marker,
      providerSellerId: connection.externalAccountId,
      providerCapabilityFingerprint: currentExecution.providerCapabilityFingerprint,
      providerPublicationModel: currentExecution.providerPublicationModel,
      providerStockAuthority: currentExecution.providerStockAuthority,
      searchCandidateCount: 1,
      externalItemId: verified.externalItemId,
      ...(verified.externalUserProductId ? { externalUserProductId: verified.externalUserProductId } : {}),
      bindingId,
      authority: 'provider_seller_sku_search_and_item_refetch',
      recoveredByUserId,
      recoveredAt,
      serverRecoveredAt: FieldValue.serverTimestamp(),
    });
  });

  return {
    executionId,
    proposalId: execution.proposalId,
    authorizationId: execution.authorizationId,
    status: 'published',
    recoveryStatus: 'recovered_from_provider_search',
    externalItemId: verified.externalItemId,
    ...(verified.externalUserProductId ? { externalUserProductId: verified.externalUserProductId } : {}),
    bindingId,
    providerStatus: verified.providerStatus,
    providerPublicationModel: execution.providerPublicationModel,
    ...(verified.permalink ? { permalink: verified.permalink } : {}),
  };
};
