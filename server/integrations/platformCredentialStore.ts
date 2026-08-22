import { FieldValue } from 'firebase-admin/firestore';
import type {
  KyrubIntegrationCredentialRecord,
  KyrubIntegrationEnvironment,
  KyrubIntegrationProviderId,
} from '../../shared/integrationCredentials.js';
import { adminDb } from '../firebaseAdmin.js';
import {
  decryptIntegrationSecret,
  encryptIntegrationSecret,
  getIntegrationMasterKey,
  type EncryptedSecretEnvelope,
} from './secretVault.js';

const COLLECTION = 'platformIntegrationCredentials';

interface StoredPlatformCredentialDocument {
  id: string;
  providerId: KyrubIntegrationProviderId;
  environment: KyrubIntegrationEnvironment;
  status: 'configured' | 'validated' | 'disabled' | 'error';
  enabled: boolean;
  encryptedCredentials: EncryptedSecretEnvelope;
  last4: Record<string, string>;
  createdAt?: unknown;
  updatedAt?: unknown;
  lastValidatedAt?: unknown;
  lastValidationCode?: string;
}

const clean = (value: unknown): string =>
  typeof value === 'string' ? value.trim() : '';

const documentId = (
  providerId: KyrubIntegrationProviderId,
  environment: KyrubIntegrationEnvironment
): string => `${providerId}__${environment}`;

const aad = (
  providerId: KyrubIntegrationProviderId,
  environment: KyrubIntegrationEnvironment
): string => `platform:${providerId}:${environment}`;

const iso = (value: unknown): string => {
  if (
    value &&
    typeof value === 'object' &&
    'toDate' in value &&
    typeof (value as { toDate?: unknown }).toDate === 'function'
  ) {
    return (value as { toDate: () => Date }).toDate().toISOString();
  }
  return '';
};

export interface PlatformCredentialSecrets {
  access_token?: string;
  webhook_secret?: string;
  [key: string]: string | undefined;
}

const parseDocument = (
  value: unknown
): StoredPlatformCredentialDocument | null => {
  if (!value || typeof value !== 'object') return null;
  const candidate = value as Record<string, unknown>;
  const providerId = clean(candidate.providerId) as KyrubIntegrationProviderId;
  const environment = clean(candidate.environment) as KyrubIntegrationEnvironment;
  if (
    !clean(candidate.id) ||
    !providerId ||
    !environment ||
    !candidate.encryptedCredentials ||
    typeof candidate.encryptedCredentials !== 'object'
  ) {
    return null;
  }
  return candidate as unknown as StoredPlatformCredentialDocument;
};

export const savePlatformCredentials = async (input: {
  providerId: KyrubIntegrationProviderId;
  environment: KyrubIntegrationEnvironment;
  credentials: PlatformCredentialSecrets;
}): Promise<KyrubIntegrationCredentialRecord> => {
  const normalized = Object.fromEntries(
    Object.entries(input.credentials)
      .map(([key, value]) => [key, clean(value)])
      .filter(([, value]) => Boolean(value))
  ) as Record<string, string>;
  if (!Object.keys(normalized).length) {
    throw new Error('PLATFORM_CREDENTIALS_REQUIRED');
  }

  const encryptedCredentials = encryptIntegrationSecret(
    normalized,
    getIntegrationMasterKey(),
    aad(input.providerId, input.environment)
  );
  const id = documentId(input.providerId, input.environment);
  const reference = adminDb.doc(`${COLLECTION}/${id}`);
  const existing = await reference.get();
  const now = FieldValue.serverTimestamp();
  const last4 = Object.fromEntries(
    Object.entries(normalized).map(([key, value]) => [key, value.slice(-4)])
  );

  await reference.set({
    id,
    providerId: input.providerId,
    environment: input.environment,
    status: 'configured',
    enabled: true,
    encryptedCredentials,
    last4,
    updatedAt: now,
    ...(existing.exists ? {} : { createdAt: now }),
  }, { merge: true });

  const record = await loadPlatformCredentialMetadata(input.providerId, input.environment);
  if (!record) throw new Error('PLATFORM_CREDENTIAL_METADATA_MISSING');
  return record;
};

export const resolvePlatformCredentials = async (
  providerId: KyrubIntegrationProviderId,
  environment: KyrubIntegrationEnvironment
): Promise<PlatformCredentialSecrets | null> => {
  const snapshot = await adminDb.doc(`${COLLECTION}/${documentId(providerId, environment)}`).get();
  const document = parseDocument(snapshot.data());
  if (!document || document.enabled !== true || document.status === 'disabled') return null;
  return decryptIntegrationSecret<PlatformCredentialSecrets>(
    document.encryptedCredentials,
    getIntegrationMasterKey(),
    aad(providerId, environment)
  );
};

export const loadPlatformCredentialMetadata = async (
  providerId: KyrubIntegrationProviderId,
  environment: KyrubIntegrationEnvironment
): Promise<KyrubIntegrationCredentialRecord | null> => {
  const snapshot = await adminDb.doc(`${COLLECTION}/${documentId(providerId, environment)}`).get();
  const document = parseDocument(snapshot.data());
  if (!document) return null;
  return {
    id: document.id,
    providerId: document.providerId,
    environment: document.environment,
    status: document.status,
    enabled: document.enabled,
    credentials: Object.fromEntries(
      Object.entries(document.last4 ?? {}).map(([key, value]) => [key, {
        secretRef: `legacy-envelope://${document.id}/${key}`,
        last4: value,
        updatedAt: iso(document.updatedAt),
      }])
    ),
    lastValidatedAt: iso(document.lastValidatedAt) || undefined,
    lastValidationCode: clean(document.lastValidationCode) || undefined,
    createdAt: iso(document.createdAt),
    updatedAt: iso(document.updatedAt),
  };
};

export const markPlatformCredentialValidation = async (input: {
  providerId: KyrubIntegrationProviderId;
  environment: KyrubIntegrationEnvironment;
  ok: boolean;
  code: string;
}): Promise<void> => {
  await adminDb.doc(`${COLLECTION}/${documentId(input.providerId, input.environment)}`).set({
    status: input.ok ? 'validated' : 'error',
    lastValidationCode: input.code,
    lastValidatedAt: FieldValue.serverTimestamp(),
    updatedAt: FieldValue.serverTimestamp(),
  }, { merge: true });
};
