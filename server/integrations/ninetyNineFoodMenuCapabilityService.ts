import { createHash } from 'node:crypto';
import { FieldValue } from 'firebase-admin/firestore';
import { adminDb } from '../firebaseAdmin';

const PROVIDER = '99food' as const;
const DISCOVERY_AUTHORITY = 'provider_public_discovery' as const;
const CONNECTION_COLLECTION = 'integrationConnections';
const DISCOVERY_TIMEOUT_MS = 10_000;
const MAX_DISCOVERY_BYTES = 1_000_000;

const clean = (value: unknown, maximum = 2_000): string =>
  typeof value === 'string' || typeof value === 'number'
    ? String(value).trim().slice(0, maximum)
    : '';

const stringArray = (value: unknown): string[] =>
  Array.isArray(value)
    ? Array.from(new Set(value.map(entry => clean(entry, 120)).filter(Boolean)))
    : [];

const connectionId = (tenantId: string): string => `${tenantId}__${PROVIDER}`;
const connectionPath = (tenantId: string): string =>
  `${CONNECTION_COLLECTION}/${connectionId(tenantId)}`;
const snapshotPath = (tenantId: string, snapshotId: string): string =>
  `${connectionPath(tenantId)}/capabilityDiscoverySnapshots/${snapshotId}`;
const currentPath = (tenantId: string): string =>
  `${connectionPath(tenantId)}/capabilityState/menu`;

const safeDiscoveryUrl = (baseUrl: string): string => {
  const parsed = new URL(baseUrl);
  if (parsed.username || parsed.password) {
    throw new Error('NINETY_NINE_FOOD_DISCOVERY_BASE_URL_INVALID');
  }
  if (parsed.protocol !== 'https:') {
    const local = parsed.hostname === 'localhost' || parsed.hostname === '127.0.0.1';
    if (!local) throw new Error('NINETY_NINE_FOOD_DISCOVERY_BASE_URL_INVALID');
  }
  return new URL('/.well-known/opendelivery', parsed.origin).toString();
};

const normalizeEndpoint = (value: unknown): string => {
  const raw = clean(value, 2_000);
  if (!raw) return '';
  try {
    const parsed = new URL(raw);
    if (parsed.protocol !== 'https:' || parsed.username || parsed.password) return '';
    return parsed.toString().replace(/\/$/, '');
  } catch {
    return '';
  }
};

const record = (value: unknown): Record<string, unknown> =>
  value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};

export interface NinetyNineFoodMenuCapabilitySnapshot {
  schemaVersion: 1;
  id: string;
  provider: typeof PROVIDER;
  tenantId: string;
  discoveryUrl: string;
  authority: typeof DISCOVERY_AUTHORITY;
  manifestHash: string;
  appId: string;
  openDeliveryCurrentVersion: string;
  openDeliverySupportedVersions: string[];
  merchantSupported: boolean;
  merchantVersion: string;
  merchantEndpoint: string;
  supportsPartialUpdate: boolean;
  supportsFullGetByOriginator: boolean;
  status: 'merchant_v2_candidate' | 'merchant_unavailable';
  fetchedByUserId: string;
  fetchedAt: string;
}

const fetchDiscovery = async (url: string): Promise<{ text: string; json: Record<string, unknown> }> => {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), DISCOVERY_TIMEOUT_MS);
  try {
    const response = await fetch(url, {
      method: 'GET',
      headers: { accept: 'application/json' },
      signal: controller.signal,
      redirect: 'error',
    });
    if (!response.ok) {
      throw new Error(`NINETY_NINE_FOOD_DISCOVERY_HTTP_${response.status}`);
    }
    const text = await response.text();
    if (!text || Buffer.byteLength(text, 'utf8') > MAX_DISCOVERY_BYTES) {
      throw new Error('NINETY_NINE_FOOD_DISCOVERY_RESPONSE_INVALID');
    }
    let parsed: unknown;
    try {
      parsed = JSON.parse(text);
    } catch {
      throw new Error('NINETY_NINE_FOOD_DISCOVERY_RESPONSE_INVALID');
    }
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      throw new Error('NINETY_NINE_FOOD_DISCOVERY_RESPONSE_INVALID');
    }
    return { text, json: parsed as Record<string, unknown> };
  } finally {
    clearTimeout(timer);
  }
};

export const discoverNinetyNineFoodMenuCapability = async (input: {
  tenantId: string;
  requestedByUserId: string;
}): Promise<NinetyNineFoodMenuCapabilitySnapshot> => {
  const tenantId = clean(input.tenantId, 160);
  const requestedByUserId = clean(input.requestedByUserId, 160);
  if (!tenantId || requestedByUserId !== tenantId) {
    throw new Error('NINETY_NINE_FOOD_DISCOVERY_FORBIDDEN');
  }

  const connectionReference = adminDb.doc(connectionPath(tenantId));
  const connectionDocument = await connectionReference.get();
  if (!connectionDocument.exists) throw new Error('NINETY_NINE_FOOD_DISCOVERY_CONNECTION_REQUIRED');
  const connection = connectionDocument.data() as Record<string, unknown>;
  if (
    connection.provider !== PROVIDER ||
    clean(connection.tenantId, 160) !== tenantId ||
    clean(connection.status, 40) === 'disabled'
  ) {
    throw new Error('NINETY_NINE_FOOD_DISCOVERY_CONNECTION_INVALID');
  }

  const discoveryUrl = safeDiscoveryUrl(clean(connection.baseUrl, 2_000));
  const fetched = await fetchDiscovery(discoveryUrl);
  const manifest = fetched.json;
  const openDelivery = record(manifest.openDelivery);
  const capabilities = record(manifest.capabilities);
  const merchant = record(capabilities.merchant);
  const supportedVersions = stringArray(openDelivery.supportedVersions);
  const currentVersion = clean(openDelivery.currentVersion, 120);
  const merchantEndpoint = normalizeEndpoint(merchant.endpoint);
  const merchantSupported = Object.keys(merchant).length > 0 && merchant.supported !== false;
  const supportsV2 = supportedVersions.some(version => version === '2.0' || version.startsWith('2.0.')) ||
    currentVersion === '2.0' || currentVersion.startsWith('2.0.');
  const status: NinetyNineFoodMenuCapabilitySnapshot['status'] =
    supportsV2 && merchantSupported && Boolean(merchantEndpoint)
      ? 'merchant_v2_candidate'
      : 'merchant_unavailable';
  const manifestHash = createHash('sha256').update(fetched.text).digest('hex');
  const snapshotId = `99disc_${manifestHash.slice(0, 40)}`;
  const now = new Date().toISOString();
  const snapshot: NinetyNineFoodMenuCapabilitySnapshot = {
    schemaVersion: 1,
    id: snapshotId,
    provider: PROVIDER,
    tenantId,
    discoveryUrl,
    authority: DISCOVERY_AUTHORITY,
    manifestHash,
    appId: clean(manifest.appId, 240),
    openDeliveryCurrentVersion: currentVersion,
    openDeliverySupportedVersions: supportedVersions,
    merchantSupported,
    merchantVersion: clean(merchant.version, 120),
    merchantEndpoint,
    supportsPartialUpdate: merchant.supportsPartialUpdate === true,
    supportsFullGetByOriginator: merchant.supportsFullGetByOriginator === true,
    status,
    fetchedByUserId: requestedByUserId,
    fetchedAt: now,
  };

  await adminDb.runTransaction(async transaction => {
    const currentConnection = await transaction.get(connectionReference);
    const current = currentConnection.data() as Record<string, unknown> | undefined;
    if (
      !currentConnection.exists ||
      current?.provider !== PROVIDER ||
      clean(current?.tenantId, 160) !== tenantId ||
      clean(current?.baseUrl, 2_000) !== clean(connection.baseUrl, 2_000) ||
      clean(current?.status, 40) === 'disabled'
    ) {
      throw new Error('NINETY_NINE_FOOD_DISCOVERY_CONNECTION_STALE');
    }
    const snapshotReference = adminDb.doc(snapshotPath(tenantId, snapshotId));
    const existing = await transaction.get(snapshotReference);
    if (!existing.exists) {
      transaction.create(snapshotReference, {
        ...snapshot,
        serverCreatedAt: FieldValue.serverTimestamp(),
      });
    }
    transaction.set(adminDb.doc(currentPath(tenantId)), {
      ...snapshot,
      authority: 'latest_provider_public_discovery_pointer',
      updatedAt: FieldValue.serverTimestamp(),
    });
  });

  return snapshot;
};

export const getCurrentNinetyNineFoodMenuCapability = async (input: {
  tenantId: string;
  requestedByUserId: string;
}): Promise<NinetyNineFoodMenuCapabilitySnapshot | null> => {
  const tenantId = clean(input.tenantId, 160);
  const requestedByUserId = clean(input.requestedByUserId, 160);
  if (!tenantId || requestedByUserId !== tenantId) {
    throw new Error('NINETY_NINE_FOOD_DISCOVERY_FORBIDDEN');
  }
  const document = await adminDb.doc(currentPath(tenantId)).get();
  if (!document.exists) return null;
  const data = document.data() as NinetyNineFoodMenuCapabilitySnapshot;
  if (data.provider !== PROVIDER || data.tenantId !== tenantId) {
    throw new Error('NINETY_NINE_FOOD_DISCOVERY_STATE_INVALID');
  }
  return data;
};
