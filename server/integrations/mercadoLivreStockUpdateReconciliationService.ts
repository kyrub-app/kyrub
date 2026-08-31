import { createHash } from 'node:crypto';
import { FieldValue } from 'firebase-admin/firestore';
import { adminDb } from '../firebaseAdmin.js';
import { mercadoLivreGetJson } from './mercadoLivreOauthService.js';
import { getStoreConnectionRegistryRecord } from './storeConnectionRegistry.js';

interface StockExecutionRecord {
  schemaVersion: 1;
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
  channelAvailabilitySnapshotId: string;
  channelAvailabilitySourceFingerprint: string;
  channelAvailabilityPolicyRevision: number;
  providerStockMode: 'item_available_quantity';
  targetAvailableQuantity: number;
  payloadHash: string;
  status: 'provider_write_succeeded' | 'reconciliation_required' | 'reconciled';
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

const sha256 = (value: string): string =>
  createHash('sha256').update(value).digest('hex');

const assertExecution = (
  storeId: string,
  executionId: string,
  value: unknown
): StockExecutionRecord => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('MERCADO_LIVRE_STOCK_UPDATE_EXECUTION_NOT_FOUND');
  }
  const record = value as Record<string, unknown>;
  const target = nonNegativeInteger(record.targetAvailableQuantity);
  if (
    Number(record.schemaVersion) !== 1 ||
    clean(record.id, 160) !== executionId ||
    clean(record.storeId, 160) !== storeId ||
    record.provider !== 'mercado_livre' ||
    record.providerStockMode !== 'item_available_quantity' ||
    (record.status !== 'provider_write_succeeded' &&
      record.status !== 'reconciliation_required' &&
      record.status !== 'reconciled') ||
    !clean(record.proposalId, 160) ||
    !clean(record.authorizationId, 160) ||
    !clean(record.connectionId, 200) ||
    !clean(record.bindingId, 160) ||
    !clean(record.externalItemId, 160) ||
    !clean(record.canonicalStoreId, 160) ||
    !clean(record.canonicalProductId, 160) ||
    !clean(record.channelAvailabilitySnapshotId, 160) ||
    !clean(record.channelAvailabilitySourceFingerprint, 100) ||
    !Number.isSafeInteger(Number(record.channelAvailabilityPolicyRevision)) ||
    target === null ||
    !clean(record.payloadHash, 100)
  ) {
    throw new Error('MERCADO_LIVRE_STOCK_UPDATE_EXECUTION_INVALID');
  }
  return record as unknown as StockExecutionRecord;
};

export interface MercadoLivreStockUpdateReconciliationResult {
  executionId: string;
  proposalId: string;
  authorizationId: string;
  externalItemId: string;
  targetAvailableQuantity: number;
  observedAvailableQuantity: number;
  providerSnapshotId: string;
  status: 'reconciled';
  authority: 'provider_api_refetch_stock_reconciliation';
  alreadyReconciled: boolean;
}

export const reconcileMercadoLivreStockUpdate = async (input: {
  storeId: string;
  executionId: string;
  reconciledByUserId: string;
}): Promise<MercadoLivreStockUpdateReconciliationResult> => {
  const storeId = clean(input.storeId, 160);
  const executionId = clean(input.executionId, 160);
  const reconciledByUserId = clean(input.reconciledByUserId, 160);
  if (!storeId || !executionId || reconciledByUserId !== storeId) {
    throw new Error('MERCADO_LIVRE_STOCK_UPDATE_RECONCILIATION_TARGET_INVALID');
  }

  const executionRef = adminDb.doc(
    `stores/${storeId}/catalogOutboundStockExecutions/${executionId}`
  );
  const executionDoc = await executionRef.get();
  const execution = assertExecution(storeId, executionId, executionDoc.data());

  if (execution.status === 'reconciled') {
    const data = executionDoc.data() as Record<string, unknown>;
    const observed = nonNegativeInteger(data.reconciledAvailableQuantity);
    const providerSnapshotId = clean(data.providerSnapshotId, 160);
    if (observed === null || !providerSnapshotId) {
      throw new Error('MERCADO_LIVRE_STOCK_UPDATE_RECONCILIATION_INVALID');
    }
    return {
      executionId,
      proposalId: execution.proposalId,
      authorizationId: execution.authorizationId,
      externalItemId: execution.externalItemId,
      targetAvailableQuantity: execution.targetAvailableQuantity,
      observedAvailableQuantity: observed,
      providerSnapshotId,
      status: 'reconciled',
      authority: 'provider_api_refetch_stock_reconciliation',
      alreadyReconciled: true,
    };
  }

  const connection = await getStoreConnectionRegistryRecord({
    storeId,
    connectionId: execution.connectionId,
  });
  if (
    !connection ||
    connection.provider !== 'mercado_livre' ||
    connection.status !== 'connected' ||
    connection.syncAuthority !== 'manual_review'
  ) {
    throw new Error('MERCADO_LIVRE_CONNECTION_INVALID');
  }

  const providerRaw = await mercadoLivreGetJson<unknown>(
    storeId,
    `/items/${encodeURIComponent(execution.externalItemId)}`
  );
  if (!providerRaw || typeof providerRaw !== 'object' || Array.isArray(providerRaw)) {
    throw new Error('MERCADO_LIVRE_ITEM_RESPONSE_INVALID');
  }
  const provider = providerRaw as ProviderItem;
  const itemId = clean(provider.id, 160);
  const sellerId = clean(provider.seller_id, 160);
  const userProductId = clean(provider.user_product_id, 160);
  const observedAvailableQuantity = nonNegativeInteger(provider.available_quantity);
  if (
    itemId !== execution.externalItemId ||
    sellerId !== connection.externalAccountId ||
    userProductId
  ) {
    throw new Error('MERCADO_LIVRE_STOCK_UPDATE_RECONCILIATION_IDENTITY_MISMATCH');
  }
  if (observedAvailableQuantity !== execution.targetAvailableQuantity) {
    await executionRef.set({
      status: 'reconciliation_required',
      lastReconciliationObservedQuantity: observedAvailableQuantity,
      lastReconciliationAttemptAt: new Date().toISOString(),
      serverLastReconciliationAttemptAt: FieldValue.serverTimestamp(),
    }, { merge: true });
    throw new Error('MERCADO_LIVRE_STOCK_UPDATE_TARGET_NOT_OBSERVED');
  }

  const providerEvidence = {
    externalItemId: itemId,
    sellerId,
    availableQuantity: observedAvailableQuantity,
    userProductId,
    status: clean(provider.status, 80),
    observedForExecutionId: executionId,
    targetAvailableQuantity: execution.targetAvailableQuantity,
  };
  const providerSnapshotId = `mlstocksnap_${sha256(JSON.stringify(providerEvidence)).slice(0, 40)}`;
  const providerSnapshotRef = adminDb.doc(
    `stores/${storeId}/externalStockSnapshots/${providerSnapshotId}`
  );
  const authorizationRef = adminDb.doc(
    `stores/${storeId}/catalogOutboundStockAuthorizations/${execution.authorizationId}`
  );
  const proposalRef = adminDb.doc(
    `stores/${storeId}/catalogOutboundStockProposals/${execution.proposalId}`
  );
  const auditId = `mlstockrec_${sha256(`${storeId}:${executionId}:${providerSnapshotId}`).slice(0, 40)}`;
  const auditRef = adminDb.doc(`stores/${storeId}/catalogOutboundStockReconciliations/${auditId}`);
  const reconciledAt = new Date().toISOString();

  await adminDb.runTransaction(async transaction => {
    const [currentExecutionDoc, currentSnapshotDoc, currentAuditDoc] = await Promise.all([
      transaction.get(executionRef),
      transaction.get(providerSnapshotRef),
      transaction.get(auditRef),
    ]);
    const currentExecution = assertExecution(storeId, executionId, currentExecutionDoc.data());
    if (currentExecution.status === 'reconciled') return;
    if (
      currentExecution.targetAvailableQuantity !== execution.targetAvailableQuantity ||
      currentExecution.authorizationId !== execution.authorizationId ||
      currentExecution.proposalId !== execution.proposalId
    ) {
      throw new Error('MERCADO_LIVRE_STOCK_UPDATE_RECONCILIATION_STALE');
    }

    if (!currentSnapshotDoc.exists) {
      transaction.create(providerSnapshotRef, {
        schemaVersion: 1,
        id: providerSnapshotId,
        storeId,
        provider: 'mercado_livre',
        connectionId: execution.connectionId,
        bindingId: execution.bindingId,
        externalItemId: execution.externalItemId,
        canonicalStoreId: execution.canonicalStoreId,
        canonicalProductId: execution.canonicalProductId,
        authority: 'provider_api_refetch',
        evidence: providerEvidence,
        createdAt: reconciledAt,
        serverCreatedAt: FieldValue.serverTimestamp(),
      });
    }
    if (!currentAuditDoc.exists) {
      transaction.create(auditRef, {
        schemaVersion: 1,
        id: auditId,
        storeId,
        provider: 'mercado_livre',
        executionId,
        proposalId: execution.proposalId,
        authorizationId: execution.authorizationId,
        bindingId: execution.bindingId,
        externalItemId: execution.externalItemId,
        channelAvailabilitySnapshotId: execution.channelAvailabilitySnapshotId,
        channelAvailabilitySourceFingerprint: execution.channelAvailabilitySourceFingerprint,
        channelAvailabilityPolicyRevision: execution.channelAvailabilityPolicyRevision,
        targetAvailableQuantity: execution.targetAvailableQuantity,
        observedAvailableQuantity,
        providerSnapshotId,
        authority: 'provider_api_refetch_stock_reconciliation',
        reconciledByUserId,
        reconciledAt,
        serverReconciledAt: FieldValue.serverTimestamp(),
      });
    }
    transaction.update(executionRef, {
      status: 'reconciled',
      reconciledAvailableQuantity: observedAvailableQuantity,
      providerSnapshotId,
      stockReconciliationId: auditId,
      reconciledAt,
      serverReconciledAt: FieldValue.serverTimestamp(),
    });
    transaction.update(authorizationRef, {
      consumptionStatus: 'consumed',
      stockReconciliationId: auditId,
      reconciledAt,
      serverReconciledAt: FieldValue.serverTimestamp(),
    });
    transaction.update(proposalRef, {
      executionStatus: 'reconciled',
      stockReconciliationId: auditId,
      reconciledAt,
      serverReconciledAt: FieldValue.serverTimestamp(),
    });
  });

  return {
    executionId,
    proposalId: execution.proposalId,
    authorizationId: execution.authorizationId,
    externalItemId: execution.externalItemId,
    targetAvailableQuantity: execution.targetAvailableQuantity,
    observedAvailableQuantity,
    providerSnapshotId,
    status: 'reconciled',
    authority: 'provider_api_refetch_stock_reconciliation',
    alreadyReconciled: false,
  };
};
