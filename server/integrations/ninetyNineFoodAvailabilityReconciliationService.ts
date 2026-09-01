import { createHash } from 'node:crypto';
import { FieldValue } from 'firebase-admin/firestore';
import { adminDb } from '../firebaseAdmin';
import {
  decryptIntegrationSecret,
  getIntegrationMasterKey,
  type EncryptedSecretEnvelope,
} from './secretVault';

const PROVIDER = '99food' as const;
const REQUEST_TIMEOUT_MS = 12_000;
const MAX_RESPONSE_BYTES = 5_000_000;

const clean = (value: unknown, maximum = 2_000): string =>
  typeof value === 'string' || typeof value === 'number'
    ? String(value).trim().slice(0, maximum)
    : '';

const integer = (value: unknown): number | null =>
  typeof value === 'number' && Number.isSafeInteger(value) && value >= 0 ? value : null;

const sha256 = (value: string): string => createHash('sha256').update(value).digest('hex');
const canonicalStoreIdForTenant = async (tenantId: string): Promise<string> => {
  const tenant = await adminDb.doc(`tenants/${tenantId}`).get();
  const storeId = clean(tenant.data()?.canonicalStoreId, 160);
  if (!storeId) throw new Error('NINETY_NINE_FOOD_AVAILABILITY_RECONCILIATION_CANONICAL_STORE_REQUIRED');
  return storeId;
};

const executionPath = (storeId: string, id: string) =>
  `stores/${storeId}/ninetyNineFoodAvailabilityExecutions/${id}`;
const authorizationPath = (storeId: string, id: string) =>
  `stores/${storeId}/ninetyNineFoodAvailabilityAuthorizations/${id}`;
const proposalPath = (storeId: string, id: string) =>
  `stores/${storeId}/ninetyNineFoodAvailabilityProposals/${id}`;
const connectionPath = (tenantId: string) => `integrationConnections/${tenantId}__${PROVIDER}`;
const capabilityPath = (tenantId: string) => `${connectionPath(tenantId)}/capabilityState/menu`;

interface StoredCredentials { clientId: string; clientSecret: string }
interface ProviderContext { merchantEndpoint: string; tokenUrl: string; clientId: string; clientSecret: string }

const providerContext = async (tenantId: string, execution: Record<string, unknown>): Promise<ProviderContext> => {
  const [connectionDocument, capabilityDocument] = await Promise.all([
    adminDb.doc(connectionPath(tenantId)).get(),
    adminDb.doc(capabilityPath(tenantId)).get(),
  ]);
  if (!connectionDocument.exists || !capabilityDocument.exists) {
    throw new Error('NINETY_NINE_FOOD_AVAILABILITY_RECONCILIATION_PROVIDER_CONTEXT_REQUIRED');
  }
  const connection = connectionDocument.data() as Record<string, unknown>;
  const capability = capabilityDocument.data() as Record<string, unknown>;
  if (
    connection.provider !== PROVIDER || clean(connection.tenantId, 160) !== tenantId ||
    clean(connection.externalStoreId, 500) !== clean(execution.externalStoreId, 500) ||
    connection.status !== 'connected' || capability.provider !== PROVIDER ||
    clean(capability.id, 160) !== clean(execution.capabilitySnapshotId, 160) ||
    clean(capability.manifestHash, 128) !== clean(execution.capabilityManifestHash, 128) ||
    capability.status !== 'merchant_v2_candidate'
  ) {
    throw new Error('NINETY_NINE_FOOD_AVAILABILITY_RECONCILIATION_PROVIDER_CONTEXT_STALE');
  }
  const encrypted = connection.encryptedCredentials;
  const merchantEndpoint = clean(capability.merchantEndpoint);
  const tokenUrl = clean(connection.tokenUrl);
  if (!encrypted || typeof encrypted !== 'object' || !merchantEndpoint || !tokenUrl) {
    throw new Error('NINETY_NINE_FOOD_AVAILABILITY_RECONCILIATION_PROVIDER_CONTEXT_INVALID');
  }
  const credentials = decryptIntegrationSecret<StoredCredentials>(
    encrypted as EncryptedSecretEnvelope,
    getIntegrationMasterKey(),
    `${PROVIDER}:${tenantId}`
  );
  const clientId = clean(credentials.clientId, 500);
  const clientSecret = clean(credentials.clientSecret, 2_000);
  if (!clientId || !clientSecret) throw new Error('NINETY_NINE_FOOD_AVAILABILITY_RECONCILIATION_CREDENTIALS_REQUIRED');
  return { merchantEndpoint, tokenUrl, clientId, clientSecret };
};

const fetchText = async (url: string, init: RequestInit): Promise<{ status: number; text: string }> => {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    const response = await fetch(url, { ...init, signal: controller.signal, redirect: 'error' });
    const text = await response.text();
    if (Buffer.byteLength(text, 'utf8') > MAX_RESPONSE_BYTES) {
      throw new Error('NINETY_NINE_FOOD_AVAILABILITY_RECONCILIATION_RESPONSE_TOO_LARGE');
    }
    return { status: response.status, text };
  } finally {
    clearTimeout(timer);
  }
};

const accessToken = async (context: ProviderContext): Promise<string> => {
  const response = await fetchText(context.tokenUrl, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded', accept: 'application/json' },
    body: new URLSearchParams({
      client_id: context.clientId,
      client_secret: context.clientSecret,
      grant_type: 'client_credentials',
      scope: 'od.menu',
    }),
  });
  if (response.status < 200 || response.status >= 300) {
    throw new Error(`NINETY_NINE_FOOD_AVAILABILITY_RECONCILIATION_TOKEN_HTTP_${response.status}`);
  }
  const value = JSON.parse(response.text) as Record<string, unknown>;
  const token = clean(value.access_token, 8_000);
  if (!token) throw new Error('NINETY_NINE_FOOD_AVAILABILITY_RECONCILIATION_TOKEN_INVALID');
  return token;
};

const collectExactItemOffer = (value: unknown, itemOfferId: string, output: Record<string, unknown>[]): void => {
  if (Array.isArray(value)) {
    for (const child of value) collectExactItemOffer(child, itemOfferId, output);
    return;
  }
  if (!value || typeof value !== 'object') return;
  const record = value as Record<string, unknown>;
  if (clean(record.id, 500) === itemOfferId && Object.prototype.hasOwnProperty.call(record, 'unityPrice')) {
    output.push(record);
  }
  for (const child of Object.values(record)) collectExactItemOffer(child, itemOfferId, output);
};

export const reconcileNinetyNineFoodAvailability = async (input: {
  tenantId: string;
  executionId: string;
  requestedByUserId: string;
}) => {
  const tenantId = clean(input.tenantId, 160);
  const executionId = clean(input.executionId, 160);
  const requestedByUserId = clean(input.requestedByUserId, 160);
  if (!tenantId || !executionId || requestedByUserId !== tenantId) {
    throw new Error('NINETY_NINE_FOOD_AVAILABILITY_RECONCILIATION_INPUT_INVALID');
  }
  const canonicalStoreId = await canonicalStoreIdForTenant(tenantId);
  const executionReference = adminDb.doc(executionPath(canonicalStoreId, executionId));
  const executionDocument = await executionReference.get();
  if (!executionDocument.exists) throw new Error('NINETY_NINE_FOOD_AVAILABILITY_RECONCILIATION_EXECUTION_NOT_FOUND');
  const execution = executionDocument.data() as Record<string, unknown>;
  if (
    execution.provider !== PROVIDER || clean(execution.tenantId, 160) !== tenantId ||
    !['provider_write_accepted', 'reconciliation_required'].includes(clean(execution.status, 80))
  ) {
    throw new Error('NINETY_NINE_FOOD_AVAILABILITY_RECONCILIATION_EXECUTION_INVALID');
  }

  const merchantId = clean(execution.externalStoreId, 500);
  const menuId = clean(execution.providerMenuId, 160);
  const itemOfferId = clean(execution.providerItemOfferId, 500);
  const targetQuantity = integer(execution.targetAvailableQuantity);
  const authorizationId = clean(execution.authorizationId, 160);
  const proposalId = clean(execution.proposalId, 160);
  if (!merchantId || !menuId || !itemOfferId || targetQuantity === null || !authorizationId || !proposalId) {
    throw new Error('NINETY_NINE_FOOD_AVAILABILITY_RECONCILIATION_EXECUTION_INVALID');
  }

  const context = await providerContext(tenantId, execution);
  const token = await accessToken(context);
  const relativePath = `merchants/${encodeURIComponent(merchantId)}/menus/${encodeURIComponent(menuId)}/snapshot`;
  const url = new URL(relativePath, `${context.merchantEndpoint.replace(/\/$/, '')}/`);
  if (url.origin !== new URL(context.merchantEndpoint).origin) {
    throw new Error('NINETY_NINE_FOOD_AVAILABILITY_RECONCILIATION_ENDPOINT_INVALID');
  }
  const providerResponse = await fetchText(url.toString(), {
    method: 'GET',
    headers: { accept: 'application/json', authorization: `Bearer ${token}` },
  });
  if (providerResponse.status < 200 || providerResponse.status >= 300) {
    throw new Error(`NINETY_NINE_FOOD_AVAILABILITY_RECONCILIATION_HTTP_${providerResponse.status}`);
  }
  const parsed = JSON.parse(providerResponse.text) as unknown;
  const candidates: Record<string, unknown>[] = [];
  collectExactItemOffer(parsed, itemOfferId, candidates);
  if (candidates.length !== 1) {
    throw new Error(candidates.length === 0
      ? 'NINETY_NINE_FOOD_AVAILABILITY_RECONCILIATION_ITEM_NOT_FOUND'
      : 'NINETY_NINE_FOOD_AVAILABILITY_RECONCILIATION_ITEM_AMBIGUOUS');
  }
  const observedQuantity = integer(candidates[0].quantityAvailable);
  if (observedQuantity === null) {
    throw new Error('NINETY_NINE_FOOD_AVAILABILITY_RECONCILIATION_QUANTITY_INVALID');
  }

  const providerEvidenceHash = sha256(providerResponse.text);
  const reconciled = observedQuantity === targetQuantity;
  const reconciliationId = `99far_${sha256([executionId, providerEvidenceHash, String(observedQuantity), String(targetQuantity)].join(':')).slice(0, 40)}`;
  const observedAt = new Date().toISOString();
  const snapshotReference = adminDb.doc(
    `stores/${canonicalStoreId}/ninetyNineFoodExternalAvailabilitySnapshots/${reconciliationId}`
  );
  const reconciliationReference = adminDb.doc(
    `stores/${canonicalStoreId}/ninetyNineFoodAvailabilityReconciliations/${reconciliationId}`
  );
  const authorizationReference = adminDb.doc(authorizationPath(canonicalStoreId, authorizationId));
  const proposalReference = adminDb.doc(proposalPath(canonicalStoreId, proposalId));

  await adminDb.runTransaction(async transaction => {
    const [executionNow, authorizationNow, proposalNow, existingReconciliation] = await Promise.all([
      transaction.get(executionReference),
      transaction.get(authorizationReference),
      transaction.get(proposalReference),
      transaction.get(reconciliationReference),
    ]);
    if (!executionNow.exists || !authorizationNow.exists || !proposalNow.exists) {
      throw new Error('NINETY_NINE_FOOD_AVAILABILITY_RECONCILIATION_STATE_CONFLICT');
    }
    const currentExecution = executionNow.data() as Record<string, unknown>;
    if (
      clean(currentExecution.providerItemOfferId, 500) !== itemOfferId ||
      integer(currentExecution.targetAvailableQuantity) !== targetQuantity ||
      !['provider_write_accepted', 'reconciliation_required'].includes(clean(currentExecution.status, 80))
    ) {
      throw new Error('NINETY_NINE_FOOD_AVAILABILITY_RECONCILIATION_STATE_CONFLICT');
    }
    if (!existingReconciliation.exists) {
      transaction.create(snapshotReference, {
        schemaVersion: 1,
        id: reconciliationId,
        provider: PROVIDER,
        tenantId,
        canonicalStoreId,
        executionId,
        merchantId,
        menuId,
        itemOfferId,
        observedQuantityAvailable: observedQuantity,
        providerEvidenceHash,
        authority: 'provider_merchant_snapshot_refetch',
        observedAt,
        createdAt: FieldValue.serverTimestamp(),
      });
      transaction.create(reconciliationReference, {
        schemaVersion: 1,
        id: reconciliationId,
        provider: PROVIDER,
        tenantId,
        canonicalStoreId,
        executionId,
        authorizationId,
        proposalId,
        targetAvailableQuantity: targetQuantity,
        observedQuantityAvailable: observedQuantity,
        providerEvidenceHash,
        status: reconciled ? 'reconciled' : 'reconciliation_required',
        authority: 'provider_merchant_snapshot_refetch_comparison',
        reconciledByUserId: requestedByUserId,
        observedAt,
        createdAt: FieldValue.serverTimestamp(),
      });
    }
    const nextStatus = reconciled ? 'reconciled' : 'reconciliation_required';
    transaction.update(executionReference, {
      status: nextStatus,
      reconciliationId,
      observedQuantityAvailable: observedQuantity,
      reconciledAt: reconciled ? observedAt : null,
      updatedAt: FieldValue.serverTimestamp(),
    });
    transaction.update(authorizationReference, {
      status: reconciled ? 'consumed' : 'reconciliation_required',
      executionStatus: nextStatus,
      reconciliationId,
      observedQuantityAvailable: observedQuantity,
      updatedAt: FieldValue.serverTimestamp(),
    });
    transaction.update(proposalReference, {
      executionStatus: nextStatus,
      reconciliationId,
      observedQuantityAvailable: observedQuantity,
      updatedAt: FieldValue.serverTimestamp(),
    });
  });

  return {
    reconciliationId,
    executionId,
    targetAvailableQuantity: targetQuantity,
    observedQuantityAvailable: observedQuantity,
    status: reconciled ? 'reconciled' as const : 'reconciliation_required' as const,
    providerEvidenceHash,
    authority: 'provider_merchant_snapshot_refetch_comparison' as const,
  };
};
