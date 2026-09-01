import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import { FieldValue, Timestamp } from 'firebase-admin/firestore';
import { adminDb } from '../firebaseAdmin';
import {
  decryptIntegrationSecret,
  getIntegrationMasterKey,
  type EncryptedSecretEnvelope,
} from './secretVault';

const PROVIDER = '99food' as const;
const AUTHORITY = 'store_owner_99food_availability_authorization' as const;
const BINDING_AUTHORITY = 'store_owner_product_mapping' as const;
const SNAPSHOT_AUTHORITY = 'kyrub_inventory_reservation_policy_snapshot' as const;
const REQUEST_TIMEOUT_MS = 12_000;
const MAX_RESPONSE_BYTES = 1_000_000;

const clean = (value: unknown, maximum = 2_000): string =>
  typeof value === 'string' || typeof value === 'number'
    ? String(value).trim().slice(0, maximum)
    : '';

const integer = (value: unknown): number | null =>
  typeof value === 'number' && Number.isSafeInteger(value) && value >= 0 ? value : null;

const sha256 = (value: string): string => createHash('sha256').update(value).digest('hex');

const tokenMatches = (expectedHex: string, token: string): boolean => {
  if (!expectedHex || !token) return false;
  const actualHex = sha256(token);
  const expected = Buffer.from(expectedHex, 'hex');
  const actual = Buffer.from(actualHex, 'hex');
  return expected.length === actual.length && timingSafeEqual(expected, actual);
};

const canonicalStoreIdForTenant = async (tenantId: string): Promise<string> => {
  const tenant = await adminDb.doc(`tenants/${tenantId}`).get();
  const canonicalStoreId = clean(tenant.data()?.canonicalStoreId, 160);
  if (!canonicalStoreId) throw new Error('NINETY_NINE_FOOD_AVAILABILITY_EXECUTION_CANONICAL_STORE_REQUIRED');
  return canonicalStoreId;
};

const authorizationPath = (storeId: string, authorizationId: string): string =>
  `stores/${storeId}/ninetyNineFoodAvailabilityAuthorizations/${authorizationId}`;
const executionPath = (storeId: string, executionId: string): string =>
  `stores/${storeId}/ninetyNineFoodAvailabilityExecutions/${executionId}`;
const proposalPath = (storeId: string, proposalId: string): string =>
  `stores/${storeId}/ninetyNineFoodAvailabilityProposals/${proposalId}`;
const identityPath = (storeId: string, bindingId: string): string =>
  `stores/${storeId}/ninetyNineFoodCatalogIdentityCurrent/${bindingId}`;
const connectionPath = (tenantId: string): string => `integrationConnections/${tenantId}__${PROVIDER}`;
const capabilityPath = (tenantId: string): string => `${connectionPath(tenantId)}/capabilityState/menu`;

interface StoredCredentials {
  clientId: string;
  clientSecret: string;
}

interface ProviderContext {
  merchantEndpoint: string;
  tokenUrl: string;
  clientId: string;
  clientSecret: string;
}

export interface NinetyNineFoodAvailabilityExecution {
  schemaVersion: 1;
  id: string;
  provider: typeof PROVIDER;
  tenantId: string;
  canonicalStoreId: string;
  authorizationId: string;
  proposalId: string;
  bindingId: string;
  bindingRevision: number;
  canonicalProductId: string;
  externalStoreId: string;
  externalProductId: string;
  channelAvailabilitySnapshotId: string;
  channelAvailabilitySourceFingerprint: string;
  targetAvailableQuantity: number;
  capabilitySnapshotId: string;
  capabilityManifestHash: string;
  catalogIdentityResolutionId: string;
  catalogIdentityProviderEvidenceHash: string;
  providerMenuId: string;
  providerItemOfferId: string;
  providerOperation: 'updateItemOffer';
  httpMethod: 'PATCH';
  relativePath: string;
  requestBody: { quantityAvailable: number };
  requestBodyHash: string;
  status: 'executing' | 'provider_write_accepted' | 'provider_rejected' | 'reconciliation_required';
  providerHttpStatus: number | null;
  providerResponseBodyHash: string;
  attemptedByUserId: string;
  attemptedAt: string;
}

const assertAuthorization = (input: {
  value: Record<string, unknown>;
  tenantId: string;
  canonicalStoreId: string;
  authorizationId: string;
  authorizationToken: string;
}): {
  proposalId: string;
  bindingId: string;
  bindingRevision: number;
  canonicalProductId: string;
  externalStoreId: string;
  externalProductId: string;
  snapshotId: string;
  sourceFingerprint: string;
  targetAvailableQuantity: number;
  capabilitySnapshotId: string;
  capabilityManifestHash: string;
  identityResolutionId: string;
  identityEvidenceHash: string;
  providerMenuId: string;
  providerItemOfferId: string;
} => {
  const value = input.value;
  const bindingRevision = integer(value.bindingRevision);
  const targetAvailableQuantity = integer(value.targetAvailableQuantity);
  const useCount = integer(value.useCount);
  const mutation = value.intendedMutation && typeof value.intendedMutation === 'object'
    ? value.intendedMutation as Record<string, unknown>
    : {};
  if (
    value.provider !== PROVIDER || value.authority !== AUTHORITY ||
    clean(value.tenantId, 160) !== input.tenantId ||
    clean(value.canonicalStoreId, 160) !== input.canonicalStoreId ||
    clean(value.id, 160) !== input.authorizationId ||
    value.status !== 'authorized' || value.executionStatus !== 'not_executed' || useCount !== 0 ||
    !tokenMatches(clean(value.tokenHash, 128), input.authorizationToken) ||
    !clean(value.expiresAt, 80) || Date.parse(clean(value.expiresAt, 80)) <= Date.now() ||
    bindingRevision === null || bindingRevision < 1 || targetAvailableQuantity === null ||
    mutation.contract !== 'merchant_v2_item_offer_quantity_available' ||
    mutation.field !== 'quantityAvailable' || integer(mutation.value) !== targetAvailableQuantity
  ) {
    throw new Error('NINETY_NINE_FOOD_AVAILABILITY_EXECUTION_AUTHORIZATION_INVALID');
  }
  const result = {
    proposalId: clean(value.proposalId, 160),
    bindingId: clean(value.bindingId, 160),
    bindingRevision,
    canonicalProductId: clean(value.canonicalProductId, 160),
    externalStoreId: clean(value.externalStoreId, 500),
    externalProductId: clean(value.externalProductId, 500),
    snapshotId: clean(value.channelAvailabilitySnapshotId, 160),
    sourceFingerprint: clean(value.channelAvailabilitySourceFingerprint, 160),
    targetAvailableQuantity,
    capabilitySnapshotId: clean(value.capabilitySnapshotId, 160),
    capabilityManifestHash: clean(value.capabilityManifestHash, 128),
    identityResolutionId: clean(value.catalogIdentityResolutionId, 160),
    identityEvidenceHash: clean(value.catalogIdentityProviderEvidenceHash, 128),
    providerMenuId: clean(value.providerMenuId, 160),
    providerItemOfferId: clean(value.providerItemOfferId, 500),
  };
  if (Object.values(result).some(entry => entry === '')) {
    throw new Error('NINETY_NINE_FOOD_AVAILABILITY_EXECUTION_AUTHORIZATION_INVALID');
  }
  return result;
};

const providerContext = async (input: {
  tenantId: string;
  externalStoreId: string;
  capabilitySnapshotId: string;
  capabilityManifestHash: string;
}): Promise<ProviderContext> => {
  const [connectionDocument, capabilityDocument] = await Promise.all([
    adminDb.doc(connectionPath(input.tenantId)).get(),
    adminDb.doc(capabilityPath(input.tenantId)).get(),
  ]);
  if (!connectionDocument.exists || !capabilityDocument.exists) {
    throw new Error('NINETY_NINE_FOOD_AVAILABILITY_EXECUTION_PROVIDER_CONTEXT_REQUIRED');
  }
  const connection = connectionDocument.data() as Record<string, unknown>;
  const capability = capabilityDocument.data() as Record<string, unknown>;
  if (
    connection.provider !== PROVIDER || clean(connection.tenantId, 160) !== input.tenantId ||
    clean(connection.externalStoreId, 500) !== input.externalStoreId || connection.status !== 'connected' ||
    capability.provider !== PROVIDER || clean(capability.tenantId, 160) !== input.tenantId ||
    clean(capability.id, 160) !== input.capabilitySnapshotId ||
    clean(capability.manifestHash, 128) !== input.capabilityManifestHash ||
    capability.status !== 'merchant_v2_candidate' || capability.supportsPartialUpdate !== true
  ) {
    throw new Error('NINETY_NINE_FOOD_AVAILABILITY_EXECUTION_PROVIDER_CONTEXT_STALE');
  }
  const merchantEndpoint = clean(capability.merchantEndpoint, 2_000);
  const tokenUrl = clean(connection.tokenUrl, 2_000);
  const encryptedCredentials = connection.encryptedCredentials;
  if (!merchantEndpoint || !tokenUrl || !encryptedCredentials || typeof encryptedCredentials !== 'object') {
    throw new Error('NINETY_NINE_FOOD_AVAILABILITY_EXECUTION_PROVIDER_CONTEXT_INVALID');
  }
  const credentials = decryptIntegrationSecret<StoredCredentials>(
    encryptedCredentials as EncryptedSecretEnvelope,
    getIntegrationMasterKey(),
    `${PROVIDER}:${input.tenantId}`
  );
  const clientId = clean(credentials.clientId, 500);
  const clientSecret = clean(credentials.clientSecret, 2_000);
  if (!clientId || !clientSecret) {
    throw new Error('NINETY_NINE_FOOD_AVAILABILITY_EXECUTION_CREDENTIALS_REQUIRED');
  }
  return { merchantEndpoint, tokenUrl, clientId, clientSecret };
};

const accessToken = async (context: ProviderContext): Promise<string> => {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    const response = await fetch(context.tokenUrl, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded', accept: 'application/json' },
      body: new URLSearchParams({
        client_id: context.clientId,
        client_secret: context.clientSecret,
        grant_type: 'client_credentials',
        scope: 'od.menu',
      }),
      redirect: 'error',
      signal: controller.signal,
    });
    const text = await response.text();
    if (!response.ok) throw new Error(`NINETY_NINE_FOOD_AVAILABILITY_EXECUTION_TOKEN_HTTP_${response.status}`);
    if (!text || Buffer.byteLength(text, 'utf8') > MAX_RESPONSE_BYTES) {
      throw new Error('NINETY_NINE_FOOD_AVAILABILITY_EXECUTION_TOKEN_RESPONSE_INVALID');
    }
    const value = JSON.parse(text) as Record<string, unknown>;
    const token = clean(value.access_token, 8_000);
    if (!token) throw new Error('NINETY_NINE_FOOD_AVAILABILITY_EXECUTION_TOKEN_RESPONSE_INVALID');
    return token;
  } finally {
    clearTimeout(timer);
  }
};

const patchUrl = (context: ProviderContext, input: {
  merchantId: string;
  menuId: string;
  itemOfferId: string;
}): { url: string; relativePath: string } => {
  const relativePath = `merchants/${encodeURIComponent(input.merchantId)}/menus/${encodeURIComponent(input.menuId)}/item-offers/${encodeURIComponent(input.itemOfferId)}`;
  const base = `${context.merchantEndpoint.replace(/\/$/, '')}/`;
  const url = new URL(relativePath, base);
  if (url.origin !== new URL(context.merchantEndpoint).origin) {
    throw new Error('NINETY_NINE_FOOD_AVAILABILITY_EXECUTION_ENDPOINT_INVALID');
  }
  return { url: url.toString(), relativePath };
};

export const executeNinetyNineFoodAvailability = async (input: {
  tenantId: string;
  authorizationId: string;
  authorizationToken: string;
  attemptedByUserId: string;
}): Promise<{ execution: NinetyNineFoodAvailabilityExecution }> => {
  const tenantId = clean(input.tenantId, 160);
  const authorizationId = clean(input.authorizationId, 160);
  const authorizationToken = clean(input.authorizationToken, 4_000);
  const attemptedByUserId = clean(input.attemptedByUserId, 160);
  if (!tenantId || !authorizationId || !authorizationToken || attemptedByUserId !== tenantId) {
    throw new Error('NINETY_NINE_FOOD_AVAILABILITY_EXECUTION_INPUT_INVALID');
  }

  const canonicalStoreId = await canonicalStoreIdForTenant(tenantId);
  const authorizationReference = adminDb.doc(authorizationPath(canonicalStoreId, authorizationId));
  const authorizationDocument = await authorizationReference.get();
  if (!authorizationDocument.exists) throw new Error('NINETY_NINE_FOOD_AVAILABILITY_EXECUTION_AUTHORIZATION_NOT_FOUND');
  const frozen = assertAuthorization({
    value: authorizationDocument.data() as Record<string, unknown>,
    tenantId,
    canonicalStoreId,
    authorizationId,
    authorizationToken,
  });

  const context = await providerContext({
    tenantId,
    externalStoreId: frozen.externalStoreId,
    capabilitySnapshotId: frozen.capabilitySnapshotId,
    capabilityManifestHash: frozen.capabilityManifestHash,
  });
  const token = await accessToken(context);
  const target = patchUrl(context, {
    merchantId: frozen.externalStoreId,
    menuId: frozen.providerMenuId,
    itemOfferId: frozen.providerItemOfferId,
  });
  const requestBody = { quantityAvailable: frozen.targetAvailableQuantity };
  const requestBodyText = JSON.stringify(requestBody);
  const requestBodyHash = sha256(requestBodyText);
  const executionId = `99fae_${randomBytes(20).toString('hex')}`;
  const executionReference = adminDb.doc(executionPath(canonicalStoreId, executionId));
  const proposalReference = adminDb.doc(proposalPath(canonicalStoreId, frozen.proposalId));
  const attemptedAt = new Date().toISOString();

  const execution: NinetyNineFoodAvailabilityExecution = {
    schemaVersion: 1,
    id: executionId,
    provider: PROVIDER,
    tenantId,
    canonicalStoreId,
    authorizationId,
    proposalId: frozen.proposalId,
    bindingId: frozen.bindingId,
    bindingRevision: frozen.bindingRevision,
    canonicalProductId: frozen.canonicalProductId,
    externalStoreId: frozen.externalStoreId,
    externalProductId: frozen.externalProductId,
    channelAvailabilitySnapshotId: frozen.snapshotId,
    channelAvailabilitySourceFingerprint: frozen.sourceFingerprint,
    targetAvailableQuantity: frozen.targetAvailableQuantity,
    capabilitySnapshotId: frozen.capabilitySnapshotId,
    capabilityManifestHash: frozen.capabilityManifestHash,
    catalogIdentityResolutionId: frozen.identityResolutionId,
    catalogIdentityProviderEvidenceHash: frozen.identityEvidenceHash,
    providerMenuId: frozen.providerMenuId,
    providerItemOfferId: frozen.providerItemOfferId,
    providerOperation: 'updateItemOffer',
    httpMethod: 'PATCH',
    relativePath: target.relativePath,
    requestBody,
    requestBodyHash,
    status: 'executing',
    providerHttpStatus: null,
    providerResponseBodyHash: '',
    attemptedByUserId,
    attemptedAt,
  };

  await adminDb.runTransaction(async transaction => {
    const [authorizationNowDocument, proposalDocument, bindingDocument, snapshotDocument, identityDocument, capabilityDocument] = await Promise.all([
      transaction.get(authorizationReference),
      transaction.get(proposalReference),
      transaction.get(adminDb.doc(`stores/${canonicalStoreId}/externalProductBindings/${frozen.bindingId}`)),
      transaction.get(adminDb.doc(`stores/${canonicalStoreId}/channelAvailabilitySnapshots/${frozen.snapshotId}`)),
      transaction.get(adminDb.doc(identityPath(canonicalStoreId, frozen.bindingId))),
      transaction.get(adminDb.doc(capabilityPath(tenantId))),
    ]);
    const authNow = authorizationNowDocument.data() as Record<string, unknown> | undefined;
    const proposal = proposalDocument.data() as Record<string, unknown> | undefined;
    const binding = bindingDocument.data() as Record<string, unknown> | undefined;
    const snapshot = snapshotDocument.data() as Record<string, unknown> | undefined;
    const identity = identityDocument.data() as Record<string, unknown> | undefined;
    const capability = capabilityDocument.data() as Record<string, unknown> | undefined;
    if (!authNow) throw new Error('NINETY_NINE_FOOD_AVAILABILITY_EXECUTION_AUTHORIZATION_NOT_FOUND');
    assertAuthorization({ value: authNow, tenantId, canonicalStoreId, authorizationId, authorizationToken });
    const tokenExpiresAt = authNow.tokenExpiresAt;
    if (tokenExpiresAt instanceof Timestamp && tokenExpiresAt.toMillis() <= Date.now()) {
      throw new Error('NINETY_NINE_FOOD_AVAILABILITY_EXECUTION_AUTHORIZATION_EXPIRED');
    }
    if (!proposal || proposal.status !== 'authorized' || proposal.executionStatus !== 'authorized' || clean(proposal.activeAuthorizationId, 160) !== authorizationId) {
      throw new Error('NINETY_NINE_FOOD_AVAILABILITY_EXECUTION_PROPOSAL_STALE');
    }
    if (!binding || binding.provider !== PROVIDER || binding.bindingAuthority !== BINDING_AUTHORITY || binding.status !== 'active' || integer(binding.revision) !== frozen.bindingRevision || clean(binding.canonicalProductId, 160) !== frozen.canonicalProductId) {
      throw new Error('NINETY_NINE_FOOD_AVAILABILITY_EXECUTION_BINDING_STALE');
    }
    if (!snapshot || snapshot.authority !== SNAPSHOT_AUTHORITY || clean(snapshot.sourceFingerprint, 160) !== frozen.sourceFingerprint || integer(snapshot.publishableUnits) !== frozen.targetAvailableQuantity) {
      throw new Error('NINETY_NINE_FOOD_AVAILABILITY_EXECUTION_SNAPSHOT_STALE');
    }
    if (!identity || identity.status !== 'resolved' || clean(identity.id, 160) !== frozen.identityResolutionId || clean(identity.providerEvidenceHash, 128) !== frozen.identityEvidenceHash || clean(identity.providerMenuId, 160) !== frozen.providerMenuId || clean(identity.providerItemOfferId, 500) !== frozen.providerItemOfferId) {
      throw new Error('NINETY_NINE_FOOD_AVAILABILITY_EXECUTION_IDENTITY_STALE');
    }
    if (!capability || clean(capability.id, 160) !== frozen.capabilitySnapshotId || clean(capability.manifestHash, 128) !== frozen.capabilityManifestHash || capability.supportsPartialUpdate !== true) {
      throw new Error('NINETY_NINE_FOOD_AVAILABILITY_EXECUTION_CAPABILITY_STALE');
    }

    transaction.create(executionReference, {
      ...execution,
      createdAt: FieldValue.serverTimestamp(),
      updatedAt: FieldValue.serverTimestamp(),
    });
    transaction.update(authorizationReference, {
      status: 'executing',
      executionStatus: 'executing',
      useCount: 1,
      activeExecutionId: executionId,
      consumedAt: FieldValue.serverTimestamp(),
      updatedAt: FieldValue.serverTimestamp(),
    });
    transaction.update(proposalReference, {
      executionStatus: 'executing',
      activeExecutionId: executionId,
      updatedAt: FieldValue.serverTimestamp(),
    });
  });

  let status: NinetyNineFoodAvailabilityExecution['status'] = 'reconciliation_required';
  let providerHttpStatus: number | null = null;
  let providerResponseBodyHash = '';
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
    try {
      const response = await fetch(target.url, {
        method: 'PATCH',
        headers: {
          accept: 'application/json',
          'content-type': 'application/json',
          authorization: `Bearer ${token}`,
        },
        body: requestBodyText,
        redirect: 'error',
        signal: controller.signal,
      });
      providerHttpStatus = response.status;
      const responseText = await response.text();
      providerResponseBodyHash = sha256(
        Buffer.byteLength(responseText, 'utf8') <= MAX_RESPONSE_BYTES ? responseText : responseText.slice(0, MAX_RESPONSE_BYTES)
      );
      if (response.status === 202) status = 'provider_write_accepted';
      else if (response.status >= 400 && response.status < 500) status = 'provider_rejected';
      else status = 'reconciliation_required';
    } finally {
      clearTimeout(timer);
    }
  } catch {
    status = 'reconciliation_required';
  }

  const completedAt = new Date().toISOString();
  await adminDb.runTransaction(async transaction => {
    const currentExecution = await transaction.get(executionReference);
    const currentAuthorization = await transaction.get(authorizationReference);
    if (!currentExecution.exists || !currentAuthorization.exists) {
      throw new Error('NINETY_NINE_FOOD_AVAILABILITY_EXECUTION_PERSISTENCE_CONFLICT');
    }
    const current = currentExecution.data() as Record<string, unknown>;
    if (current.status !== 'executing' || clean(current.authorizationId, 160) !== authorizationId) {
      throw new Error('NINETY_NINE_FOOD_AVAILABILITY_EXECUTION_PERSISTENCE_CONFLICT');
    }
    transaction.update(executionReference, {
      status,
      providerHttpStatus,
      providerResponseBodyHash,
      completedAt,
      updatedAt: FieldValue.serverTimestamp(),
    });
    transaction.update(authorizationReference, {
      status: status === 'provider_write_accepted' ? 'consumed' : status,
      executionStatus: status,
      providerHttpStatus,
      completedAt,
      updatedAt: FieldValue.serverTimestamp(),
    });
    transaction.update(proposalReference, {
      executionStatus: status,
      providerHttpStatus,
      updatedAt: FieldValue.serverTimestamp(),
    });
  });

  return {
    execution: {
      ...execution,
      status,
      providerHttpStatus,
      providerResponseBodyHash,
    },
  };
};
