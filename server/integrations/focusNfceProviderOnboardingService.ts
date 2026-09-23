import { createHash } from 'node:crypto';
import { FieldValue } from 'firebase-admin/firestore';
import {
  adminDb,
  getFirebaseAdminProjectId,
} from '../firebaseAdmin.js';
import { createKyrubCredentialVault } from './kyrubCredentialVault.js';
import { parseGoogleSecretManagerRef } from './googleSecretManagerVault.js';

const ADAPTER_ID = 'focus-nfe';
const ADAPTER_VERSION = '1';
const DOCUMENT_FAMILY = 'nfce';
const ENVIRONMENT = 'sandbox';
const CONFIG_AUTHORITY = 'server_owned_fiscal_provider_configuration';
const VERIFICATION_STATUS = 'configured_unverified';

const clean = (value: unknown, maxLength = 240): string =>
  typeof value === 'string' ? value.trim().slice(0, maxLength) : '';

const record = (value: unknown): Record<string, unknown> =>
  value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};

const canonicalStoreIdForOwner = async (
  tenantId: string,
  requestedByUserId: string
): Promise<string> => {
  if (!tenantId || tenantId !== requestedByUserId) {
    throw new Error('STORE_CONNECTION_FORBIDDEN');
  }
  const tenantSnapshot = await adminDb.doc(`tenants/${tenantId}`).get();
  const canonicalStoreId = clean(tenantSnapshot.data()?.canonicalStoreId, 160);
  if (!canonicalStoreId) {
    throw new Error('FISCAL_PROVIDER_CANONICAL_STORE_REQUIRED');
  }
  return canonicalStoreId;
};

const configurationPath = (canonicalStoreId: string): string =>
  `stores/${canonicalStoreId}/fiscalProviderConfigurations/${DOCUMENT_FAMILY}`;

const expectedSecretRef = (canonicalStoreId: string): string => {
  const projectId = getFirebaseAdminProjectId();
  const storeDigest = createHash('sha256')
    .update(canonicalStoreId, 'utf8')
    .digest('hex')
    .slice(0, 32);
  const secretId = `kyrub-fiscal-focus-nfce-${storeDigest}`;
  const secretRef = `gsm://projects/${projectId}/secrets/${secretId}`;
  parseGoogleSecretManagerRef(secretRef);
  return secretRef;
};

interface StoredFocusNfceProviderConfiguration {
  schemaVersion: 1;
  canonicalStoreId: string;
  documentFamily: 'nfce';
  environment: 'sandbox';
  status: 'active' | 'inactive';
  adapterId: 'focus-nfe';
  adapterVersion: '1';
  credentialSecretRef: string;
  credentialVersion: string;
  verificationStatus: 'configured_unverified';
  credentialUpdatedAt: string;
  updatedAt: string;
  updatedByUserId: string;
  authority: 'server_owned_fiscal_provider_configuration';
}

export interface FocusNfceProviderReadiness {
  schemaVersion: 1;
  provider: 'Focus NFe';
  adapterId: 'focus-nfe';
  adapterVersion: '1';
  documentFamily: 'nfce';
  environment: 'sandbox';
  configured: boolean;
  active: boolean;
  credentialPresent: boolean;
  credentialVersion: string | null;
  verificationStatus: 'not_configured' | 'configured_unverified';
  credentialUpdatedAt: string | null;
}

const parseStoredConfiguration = (
  value: unknown,
  canonicalStoreId: string
): StoredFocusNfceProviderConfiguration => {
  const stored = record(value);
  const credentialSecretRef = clean(stored.credentialSecretRef, 320);
  const credentialVersion = clean(stored.credentialVersion, 80);
  const credentialUpdatedAt = clean(stored.credentialUpdatedAt, 64);
  const updatedAt = clean(stored.updatedAt, 64);
  const updatedByUserId = clean(stored.updatedByUserId, 160);
  const expectedRef = expectedSecretRef(canonicalStoreId);
  if (
    stored.schemaVersion !== 1 ||
    clean(stored.canonicalStoreId, 160) !== canonicalStoreId ||
    stored.documentFamily !== DOCUMENT_FAMILY ||
    stored.environment !== ENVIRONMENT ||
    (stored.status !== 'active' && stored.status !== 'inactive') ||
    stored.adapterId !== ADAPTER_ID ||
    stored.adapterVersion !== ADAPTER_VERSION ||
    stored.authority !== CONFIG_AUTHORITY ||
    stored.verificationStatus !== VERIFICATION_STATUS ||
    credentialSecretRef !== expectedRef ||
    !credentialVersion ||
    !credentialUpdatedAt ||
    !updatedAt ||
    !updatedByUserId
  ) {
    throw new Error('FISCAL_PROVIDER_CONFIGURATION_INVALID');
  }
  parseGoogleSecretManagerRef(credentialSecretRef);
  return {
    schemaVersion: 1,
    canonicalStoreId,
    documentFamily: DOCUMENT_FAMILY,
    environment: ENVIRONMENT,
    status: stored.status,
    adapterId: ADAPTER_ID,
    adapterVersion: ADAPTER_VERSION,
    credentialSecretRef,
    credentialVersion,
    verificationStatus: VERIFICATION_STATUS,
    credentialUpdatedAt,
    updatedAt,
    updatedByUserId,
    authority: CONFIG_AUTHORITY,
  };
};

const safeReadiness = (
  stored: StoredFocusNfceProviderConfiguration | null,
  credentialPresent: boolean
): FocusNfceProviderReadiness => ({
  schemaVersion: 1,
  provider: 'Focus NFe',
  adapterId: ADAPTER_ID,
  adapterVersion: ADAPTER_VERSION,
  documentFamily: DOCUMENT_FAMILY,
  environment: ENVIRONMENT,
  configured: stored !== null,
  active: stored?.status === 'active',
  credentialPresent,
  credentialVersion: stored?.credentialVersion ?? null,
  verificationStatus: stored ? VERIFICATION_STATUS : 'not_configured',
  credentialUpdatedAt: stored?.credentialUpdatedAt ?? null,
});

const loadStored = async (
  canonicalStoreId: string
): Promise<StoredFocusNfceProviderConfiguration | null> => {
  const snapshot = await adminDb.doc(configurationPath(canonicalStoreId)).get();
  return snapshot.exists
    ? parseStoredConfiguration(snapshot.data(), canonicalStoreId)
    : null;
};

export const loadFocusNfceProviderReadiness = async (input: {
  tenantId: string;
  requestedByUserId: string;
}): Promise<FocusNfceProviderReadiness> => {
  const tenantId = clean(input.tenantId, 160);
  const requestedByUserId = clean(input.requestedByUserId, 160);
  const canonicalStoreId = await canonicalStoreIdForOwner(
    tenantId,
    requestedByUserId
  );
  const stored = await loadStored(canonicalStoreId);
  if (!stored) return safeReadiness(null, false);

  const vault = createKyrubCredentialVault();
  try {
    const secret = await vault.readLatest(stored.credentialSecretRef);
    return safeReadiness(stored, Boolean(secret.value.trim()));
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (message.startsWith('KYRUB_VAULT_ACCESS_FAILED:404')) {
      return safeReadiness(stored, false);
    }
    throw error;
  }
};

export const configureOrRotateFocusNfceProvider = async (input: {
  tenantId: string;
  requestedByUserId: string;
  token: string;
  now?: Date;
}): Promise<FocusNfceProviderReadiness> => {
  const tenantId = clean(input.tenantId, 160);
  const requestedByUserId = clean(input.requestedByUserId, 160);
  const token = typeof input.token === 'string' ? input.token.trim() : '';
  if (!token) throw new Error('FOCUS_SANDBOX_TOKEN_REQUIRED');
  if (Buffer.byteLength(token, 'utf8') > 8192) {
    throw new Error('FOCUS_SANDBOX_TOKEN_INVALID');
  }

  const canonicalStoreId = await canonicalStoreIdForOwner(
    tenantId,
    requestedByUserId
  );
  const credentialSecretRef = expectedSecretRef(canonicalStoreId);
  const vault = createKyrubCredentialVault();
  await vault.ensureSecret(credentialSecretRef);
  const written = await vault.addVersion(credentialSecretRef, token);
  const nowIso = (input.now ?? new Date()).toISOString();

  const stored: StoredFocusNfceProviderConfiguration & {
    serverUpdatedAt: FieldValue;
  } = {
    schemaVersion: 1,
    canonicalStoreId,
    documentFamily: DOCUMENT_FAMILY,
    environment: ENVIRONMENT,
    status: 'active',
    adapterId: ADAPTER_ID,
    adapterVersion: ADAPTER_VERSION,
    credentialSecretRef,
    credentialVersion: written.version,
    verificationStatus: VERIFICATION_STATUS,
    credentialUpdatedAt: nowIso,
    updatedAt: nowIso,
    updatedByUserId: requestedByUserId,
    authority: CONFIG_AUTHORITY,
    serverUpdatedAt: FieldValue.serverTimestamp(),
  };

  await adminDb.doc(configurationPath(canonicalStoreId)).set(stored);
  return safeReadiness(stored, true);
};

export const deactivateFocusNfceProvider = async (input: {
  tenantId: string;
  requestedByUserId: string;
  now?: Date;
}): Promise<FocusNfceProviderReadiness> => {
  const tenantId = clean(input.tenantId, 160);
  const requestedByUserId = clean(input.requestedByUserId, 160);
  const canonicalStoreId = await canonicalStoreIdForOwner(
    tenantId,
    requestedByUserId
  );
  const stored = await loadStored(canonicalStoreId);
  if (!stored) throw new Error('FISCAL_PROVIDER_NOT_CONFIGURED');
  const nowIso = (input.now ?? new Date()).toISOString();
  const next = { ...stored, status: 'inactive' as const, updatedAt: nowIso, updatedByUserId: requestedByUserId };
  await adminDb.doc(configurationPath(canonicalStoreId)).update({
    status: 'inactive',
    updatedAt: nowIso,
    updatedByUserId: requestedByUserId,
    serverUpdatedAt: FieldValue.serverTimestamp(),
  });
  return safeReadiness(next, true);
};

export const reactivateFocusNfceProvider = async (input: {
  tenantId: string;
  requestedByUserId: string;
  now?: Date;
}): Promise<FocusNfceProviderReadiness> => {
  const tenantId = clean(input.tenantId, 160);
  const requestedByUserId = clean(input.requestedByUserId, 160);
  const canonicalStoreId = await canonicalStoreIdForOwner(
    tenantId,
    requestedByUserId
  );
  const stored = await loadStored(canonicalStoreId);
  if (!stored) throw new Error('FISCAL_PROVIDER_NOT_CONFIGURED');
  const vault = createKyrubCredentialVault();
  const secret = await vault.readLatest(stored.credentialSecretRef);
  if (!secret.value.trim()) throw new Error('FISCAL_PROVIDER_CREDENTIAL_MISSING');

  const nowIso = (input.now ?? new Date()).toISOString();
  const next = { ...stored, status: 'active' as const, updatedAt: nowIso, updatedByUserId: requestedByUserId };
  await adminDb.doc(configurationPath(canonicalStoreId)).update({
    status: 'active',
    updatedAt: nowIso,
    updatedByUserId: requestedByUserId,
    serverUpdatedAt: FieldValue.serverTimestamp(),
  });
  return safeReadiness(next, true);
};
