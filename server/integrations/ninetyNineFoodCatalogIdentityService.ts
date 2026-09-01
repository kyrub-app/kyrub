import { createHash } from 'node:crypto';
import { FieldValue } from 'firebase-admin/firestore';
import { adminDb } from '../firebaseAdmin';
import { resolveActiveNinetyNineFoodProductBinding } from './ninetyNineFoodProductBindingService';
import {
  decryptIntegrationSecret,
  getIntegrationMasterKey,
  type EncryptedSecretEnvelope,
} from './secretVault';

const PROVIDER = '99food' as const;
const RESOLUTION_AUTHORITY = 'provider_merchant_snapshot_exact_identity_match' as const;
const CONNECTION_COLLECTION = 'integrationConnections';
const MAX_RESPONSE_BYTES = 5_000_000;
const REQUEST_TIMEOUT_MS = 12_000;
const MAX_MENUS = 10;

const clean = (value: unknown, maximum = 2_000): string =>
  typeof value === 'string' || typeof value === 'number'
    ? String(value).trim().slice(0, maximum)
    : '';

const record = (value: unknown): Record<string, unknown> =>
  value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};

const stringArray = (value: unknown): string[] =>
  Array.isArray(value)
    ? Array.from(new Set(value.map(entry => clean(entry, 160)).filter(Boolean)))
    : [];

const connectionId = (tenantId: string): string => `${tenantId}__${PROVIDER}`;
const connectionPath = (tenantId: string): string =>
  `${CONNECTION_COLLECTION}/${connectionId(tenantId)}`;
const capabilityPath = (tenantId: string): string =>
  `${connectionPath(tenantId)}/capabilityState/menu`;
const resolutionPath = (canonicalStoreId: string, resolutionId: string): string =>
  `stores/${canonicalStoreId}/ninetyNineFoodCatalogIdentityResolutions/${resolutionId}`;
const currentPath = (canonicalStoreId: string, bindingId: string): string =>
  `stores/${canonicalStoreId}/ninetyNineFoodCatalogIdentityCurrent/${bindingId}`;

interface StoredCredentials {
  clientId: string;
  clientSecret: string;
}

interface ProviderContext {
  merchantId: string;
  merchantEndpoint: string;
  tokenUrl: string;
  clientId: string;
  clientSecret: string;
  capabilitySnapshotId: string;
  capabilityManifestHash: string;
  clientIdGeneration: string[];
  supportedGrantTypes: string[];
}

interface ItemOfferCandidate {
  menuId: string;
  itemOfferId: string;
  externalCode: string;
  status: string;
  quantityAvailable: number | null;
}

export interface NinetyNineFoodCatalogIdentityResolution {
  schemaVersion: 1;
  id: string;
  provider: typeof PROVIDER;
  tenantId: string;
  canonicalStoreId: string;
  canonicalProductId: string;
  bindingId: string;
  bindingRevision: number;
  externalStoreId: string;
  externalProductId: string;
  merchantId: string;
  capabilitySnapshotId: string;
  capabilityManifestHash: string;
  authenticationClientIdGeneration: string[];
  providerEvidenceHash: string;
  inspectedMenuIds: string[];
  candidateCount: number;
  status: 'resolved' | 'not_found' | 'ambiguous';
  providerMenuId: string;
  providerItemOfferId: string;
  providerItemExternalCode: string;
  authority: typeof RESOLUTION_AUTHORITY;
  resolvedByUserId: string;
  resolvedAt: string;
}

const fetchJson = async (
  url: string,
  init: RequestInit
): Promise<{ value: unknown; text: string }> => {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    const response = await fetch(url, { ...init, signal: controller.signal, redirect: 'error' });
    if (!response.ok) {
      throw new Error(`NINETY_NINE_FOOD_CATALOG_IDENTITY_HTTP_${response.status}`);
    }
    const text = await response.text();
    if (!text || Buffer.byteLength(text, 'utf8') > MAX_RESPONSE_BYTES) {
      throw new Error('NINETY_NINE_FOOD_CATALOG_IDENTITY_RESPONSE_INVALID');
    }
    try {
      return { value: JSON.parse(text), text };
    } catch {
      throw new Error('NINETY_NINE_FOOD_CATALOG_IDENTITY_RESPONSE_INVALID');
    }
  } finally {
    clearTimeout(timer);
  }
};

const providerContext = async (tenantId: string): Promise<ProviderContext> => {
  const [connectionDocument, capabilityDocument] = await Promise.all([
    adminDb.doc(connectionPath(tenantId)).get(),
    adminDb.doc(capabilityPath(tenantId)).get(),
  ]);
  if (!connectionDocument.exists) throw new Error('NINETY_NINE_FOOD_CATALOG_IDENTITY_CONNECTION_REQUIRED');
  if (!capabilityDocument.exists) throw new Error('NINETY_NINE_FOOD_CATALOG_IDENTITY_DISCOVERY_REQUIRED');

  const connection = connectionDocument.data() as Record<string, unknown>;
  const capability = capabilityDocument.data() as Record<string, unknown>;
  if (
    connection.provider !== PROVIDER ||
    clean(connection.tenantId, 160) !== tenantId ||
    clean(connection.status, 40) === 'disabled'
  ) {
    throw new Error('NINETY_NINE_FOOD_CATALOG_IDENTITY_CONNECTION_INVALID');
  }
  if (
    capability.provider !== PROVIDER ||
    clean(capability.tenantId, 160) !== tenantId ||
    clean(capability.status, 80) !== 'merchant_v2_candidate' ||
    capability.supportsFullGetByOriginator !== true
  ) {
    throw new Error('NINETY_NINE_FOOD_CATALOG_IDENTITY_MERCHANT_GET_UNAVAILABLE');
  }

  const supportedGrantTypes = stringArray(capability.authenticationSupportedGrantTypes);
  const clientIdGeneration = stringArray(capability.authenticationClientIdGeneration);
  if (!supportedGrantTypes.includes('client_credentials')) {
    throw new Error('NINETY_NINE_FOOD_CATALOG_IDENTITY_AUTHORIZATION_FLOW_REQUIRED');
  }

  const encryptedCredentials = connection.encryptedCredentials;
  if (!encryptedCredentials || typeof encryptedCredentials !== 'object') {
    throw new Error('NINETY_NINE_FOOD_CATALOG_IDENTITY_CREDENTIALS_REQUIRED');
  }
  const credentials = decryptIntegrationSecret<StoredCredentials>(
    encryptedCredentials as EncryptedSecretEnvelope,
    getIntegrationMasterKey(),
    `${PROVIDER}:${tenantId}`
  );
  const clientId = clean(credentials.clientId, 500);
  const clientSecret = clean(credentials.clientSecret, 2_000);
  if (!clientId || !clientSecret) {
    throw new Error('NINETY_NINE_FOOD_CATALOG_IDENTITY_CREDENTIALS_REQUIRED');
  }

  const merchantEndpoint = clean(capability.merchantEndpoint, 2_000);
  const tokenUrl = clean(connection.tokenUrl, 2_000);
  const merchantId = clean(connection.externalStoreId, 500);
  if (!merchantEndpoint || !tokenUrl || !merchantId) {
    throw new Error('NINETY_NINE_FOOD_CATALOG_IDENTITY_PROVIDER_CONTEXT_INVALID');
  }

  return {
    merchantId,
    merchantEndpoint,
    tokenUrl,
    clientId,
    clientSecret,
    capabilitySnapshotId: clean(capability.id, 160),
    capabilityManifestHash: clean(capability.manifestHash, 128),
    clientIdGeneration,
    supportedGrantTypes,
  };
};

const accessToken = async (context: ProviderContext): Promise<string> => {
  const body = new URLSearchParams({
    client_id: context.clientId,
    client_secret: context.clientSecret,
    grant_type: 'client_credentials',
    scope: 'od.menu',
  });
  const response = await fetchJson(context.tokenUrl, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded', accept: 'application/json' },
    body,
  });
  const payload = record(response.value);
  const token = clean(payload.access_token, 8_000);
  if (!token) throw new Error('NINETY_NINE_FOOD_CATALOG_IDENTITY_ACCESS_TOKEN_INVALID');
  return token;
};

const authenticatedGet = async (
  context: ProviderContext,
  token: string,
  relativePath: string
): Promise<{ value: unknown; text: string }> => {
  const base = `${context.merchantEndpoint.replace(/\/$/, '')}/`;
  const url = new URL(relativePath.replace(/^\//, ''), base);
  const endpointOrigin = new URL(context.merchantEndpoint).origin;
  if (url.origin !== endpointOrigin) {
    throw new Error('NINETY_NINE_FOOD_CATALOG_IDENTITY_ENDPOINT_INVALID');
  }
  return fetchJson(url.toString(), {
    method: 'GET',
    headers: { accept: 'application/json', authorization: `Bearer ${token}` },
  });
};

const menuIdsFromMerchant = (value: unknown): string[] => {
  const merchant = record(value);
  const services = Array.isArray(merchant.services) ? merchant.services : [];
  const menuIds = services.flatMap(service => {
    const menuId = clean(record(service).menuId, 160);
    return menuId ? [menuId] : [];
  });
  const direct = clean(merchant.menuId, 160);
  if (direct) menuIds.push(direct);
  return Array.from(new Set(menuIds)).slice(0, MAX_MENUS);
};

const collectItemOfferCandidates = (
  value: unknown,
  menuId: string,
  externalProductId: string,
  output: ItemOfferCandidate[]
): void => {
  if (Array.isArray(value)) {
    for (const entry of value) collectItemOfferCandidates(entry, menuId, externalProductId, output);
    return;
  }
  if (!value || typeof value !== 'object') return;
  const candidate = value as Record<string, unknown>;
  const itemOfferId = clean(candidate.id, 500);
  const externalCode = clean(candidate.externalCode, 500);
  const looksLikeItemOffer = Object.prototype.hasOwnProperty.call(candidate, 'unityPrice');
  const exactIdentityMatch = externalProductId === itemOfferId || externalProductId === externalCode;
  if (looksLikeItemOffer && exactIdentityMatch && itemOfferId) {
    const quantity = candidate.quantityAvailable;
    output.push({
      menuId,
      itemOfferId,
      externalCode,
      status: clean(candidate.status, 80),
      quantityAvailable: typeof quantity === 'number' && Number.isFinite(quantity) ? quantity : null,
    });
  }
  for (const child of Object.values(candidate)) {
    collectItemOfferCandidates(child, menuId, externalProductId, output);
  }
};

export const resolveNinetyNineFoodCatalogIdentity = async (input: {
  tenantId: string;
  externalProductId: string;
  requestedByUserId: string;
}): Promise<NinetyNineFoodCatalogIdentityResolution> => {
  const tenantId = clean(input.tenantId, 160);
  const externalProductId = clean(input.externalProductId, 500);
  const requestedByUserId = clean(input.requestedByUserId, 160);
  if (!tenantId || !externalProductId || requestedByUserId !== tenantId) {
    throw new Error('NINETY_NINE_FOOD_CATALOG_IDENTITY_INPUT_INVALID');
  }

  const binding = await resolveActiveNinetyNineFoodProductBinding({ tenantId, externalProductId });
  if (!binding) throw new Error('NINETY_NINE_FOOD_CATALOG_IDENTITY_ACTIVE_BINDING_REQUIRED');
  const context = await providerContext(tenantId);
  if (context.merchantId !== binding.externalStoreId) {
    throw new Error('NINETY_NINE_FOOD_CATALOG_IDENTITY_MERCHANT_MISMATCH');
  }

  const token = await accessToken(context);
  const merchantResponse = await authenticatedGet(
    context,
    token,
    `merchants/${encodeURIComponent(context.merchantId)}`
  );
  const menuIds = menuIdsFromMerchant(merchantResponse.value);
  if (menuIds.length === 0) throw new Error('NINETY_NINE_FOOD_CATALOG_IDENTITY_MENU_REQUIRED');

  const candidates: ItemOfferCandidate[] = [];
  const evidenceParts = [merchantResponse.text];
  for (const menuId of menuIds) {
    const snapshot = await authenticatedGet(
      context,
      token,
      `merchants/${encodeURIComponent(context.merchantId)}/menus/${encodeURIComponent(menuId)}/snapshot`
    );
    evidenceParts.push(snapshot.text);
    collectItemOfferCandidates(snapshot.value, menuId, externalProductId, candidates);
  }

  const uniqueCandidates = Array.from(
    new Map(candidates.map(candidate => [`${candidate.menuId}:${candidate.itemOfferId}`, candidate])).values()
  );
  const status: NinetyNineFoodCatalogIdentityResolution['status'] =
    uniqueCandidates.length === 1 ? 'resolved' : uniqueCandidates.length === 0 ? 'not_found' : 'ambiguous';
  const selected = status === 'resolved' ? uniqueCandidates[0] : null;
  const providerEvidenceHash = createHash('sha256').update(evidenceParts.join('\n---\n')).digest('hex');
  const resolutionId = `99cid_${createHash('sha256')
    .update([
      binding.id,
      String(binding.revision),
      context.capabilityManifestHash,
      providerEvidenceHash,
      status,
    ].join(':'))
    .digest('hex')
    .slice(0, 40)}`;
  const now = new Date().toISOString();
  const resolution: NinetyNineFoodCatalogIdentityResolution = {
    schemaVersion: 1,
    id: resolutionId,
    provider: PROVIDER,
    tenantId,
    canonicalStoreId: binding.canonicalStoreId,
    canonicalProductId: binding.canonicalProductId,
    bindingId: binding.id,
    bindingRevision: binding.revision,
    externalStoreId: binding.externalStoreId,
    externalProductId: binding.externalProductId,
    merchantId: context.merchantId,
    capabilitySnapshotId: context.capabilitySnapshotId,
    capabilityManifestHash: context.capabilityManifestHash,
    authenticationClientIdGeneration: context.clientIdGeneration,
    providerEvidenceHash,
    inspectedMenuIds: menuIds,
    candidateCount: uniqueCandidates.length,
    status,
    providerMenuId: selected?.menuId ?? '',
    providerItemOfferId: selected?.itemOfferId ?? '',
    providerItemExternalCode: selected?.externalCode ?? '',
    authority: RESOLUTION_AUTHORITY,
    resolvedByUserId: requestedByUserId,
    resolvedAt: now,
  };

  const resolutionReference = adminDb.doc(resolutionPath(binding.canonicalStoreId, resolutionId));
  await adminDb.runTransaction(async transaction => {
    const bindingReference = adminDb.doc(
      `stores/${binding.canonicalStoreId}/externalProductBindings/${binding.id}`
    );
    const [currentBinding, existingResolution] = await Promise.all([
      transaction.get(bindingReference),
      transaction.get(resolutionReference),
    ]);
    const current = currentBinding.data() as Record<string, unknown> | undefined;
    if (
      !currentBinding.exists ||
      current?.status !== 'active' ||
      Number(current?.revision) !== binding.revision ||
      clean(current?.canonicalProductId, 160) !== binding.canonicalProductId ||
      clean(current?.externalProductId, 500) !== binding.externalProductId
    ) {
      throw new Error('NINETY_NINE_FOOD_CATALOG_IDENTITY_BINDING_STALE');
    }
    if (!existingResolution.exists) {
      transaction.create(resolutionReference, {
        ...resolution,
        serverCreatedAt: FieldValue.serverTimestamp(),
      });
    }
    transaction.set(adminDb.doc(currentPath(binding.canonicalStoreId, binding.id)), {
      ...resolution,
      authority: 'latest_provider_merchant_catalog_identity_pointer',
      updatedAt: FieldValue.serverTimestamp(),
    });
  });

  return resolution;
};

export const getCurrentNinetyNineFoodCatalogIdentity = async (input: {
  tenantId: string;
  externalProductId: string;
  requestedByUserId: string;
}): Promise<NinetyNineFoodCatalogIdentityResolution | null> => {
  const tenantId = clean(input.tenantId, 160);
  const externalProductId = clean(input.externalProductId, 500);
  const requestedByUserId = clean(input.requestedByUserId, 160);
  if (!tenantId || !externalProductId || requestedByUserId !== tenantId) {
    throw new Error('NINETY_NINE_FOOD_CATALOG_IDENTITY_INPUT_INVALID');
  }
  const binding = await resolveActiveNinetyNineFoodProductBinding({ tenantId, externalProductId });
  if (!binding) return null;
  const document = await adminDb.doc(currentPath(binding.canonicalStoreId, binding.id)).get();
  if (!document.exists) return null;
  const value = document.data() as NinetyNineFoodCatalogIdentityResolution;
  return value.provider === PROVIDER && value.tenantId === tenantId && value.bindingId === binding.id
    ? value
    : null;
};
