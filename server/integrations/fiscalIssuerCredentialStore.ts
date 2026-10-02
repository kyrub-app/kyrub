import { FieldValue } from 'firebase-admin/firestore';
import { adminDb } from '../firebaseAdmin.js';
import { encryptIntegrationSecret, getIntegrationMasterKey, type EncryptedSecretEnvelope } from './secretVault.js';
import type { ManagedFiscalIssuerEnvironment } from './fiscalManagedProviderControlPlane.js';

const COLLECTION = 'fiscalIssuerCredentials';
const PROVIDER_ID = 'focus_nfe' as const;
const clean = (value: unknown): string => typeof value === 'string' ? value.trim() : '';
const safeId = (value: string): string => value.replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 180);
const documentId = (storeId: string, environment: ManagedFiscalIssuerEnvironment): string => `${safeId(storeId)}__${PROVIDER_ID}__${environment}`;
const aad = (storeId: string, environment: ManagedFiscalIssuerEnvironment): string => `fiscal-issuer:${storeId}:${PROVIDER_ID}:${environment}`;

interface StoredIssuerCredentialDocument {
  id: string;
  canonicalStoreId: string;
  providerId: typeof PROVIDER_ID;
  environment: ManagedFiscalIssuerEnvironment;
  status: 'configured' | 'validated' | 'error' | 'disabled';
  enabled: boolean;
  encryptedCredential: EncryptedSecretEnvelope;
  tokenLast4: string;
  lastValidationCode?: string;
}

export interface FiscalIssuerCredentialMetadata {
  canonicalStoreId: string;
  providerId: typeof PROVIDER_ID;
  environment: ManagedFiscalIssuerEnvironment;
  configured: boolean;
  status: StoredIssuerCredentialDocument['status'];
  tokenLast4: string;
  lastValidationCode?: string;
}

const metadataFrom = (value: unknown): FiscalIssuerCredentialMetadata | null => {
  if (!value || typeof value !== 'object') return null;
  const document = value as Partial<StoredIssuerCredentialDocument>;
  const canonicalStoreId = clean(document.canonicalStoreId);
  if (!canonicalStoreId || document.providerId !== PROVIDER_ID) return null;
  if (document.environment !== 'homologation' && document.environment !== 'production') return null;
  if (!document.status) return null;
  return { canonicalStoreId, providerId: PROVIDER_ID, environment: document.environment, configured: true, status: document.status, tokenLast4: clean(document.tokenLast4), lastValidationCode: clean(document.lastValidationCode) || undefined };
};

export const saveFiscalIssuerCredential = async (input: { canonicalStoreId: string; environment: ManagedFiscalIssuerEnvironment; token: unknown }): Promise<FiscalIssuerCredentialMetadata> => {
  const canonicalStoreId = clean(input.canonicalStoreId);
  const token = clean(input.token);
  if (!canonicalStoreId) throw new Error('FISCAL_ISSUER_STORE_REQUIRED');
  if (!token) throw new Error('FISCAL_ISSUER_TOKEN_REQUIRED');
  if (token.length > 4096) throw new Error('FISCAL_ISSUER_TOKEN_TOO_LARGE');
  const id = documentId(canonicalStoreId, input.environment);
  const ref = adminDb.doc(`${COLLECTION}/${id}`);
  const existing = await ref.get();
  await ref.set({ id, canonicalStoreId, providerId: PROVIDER_ID, environment: input.environment, status: 'configured', enabled: true, encryptedCredential: encryptIntegrationSecret({ token }, getIntegrationMasterKey(), aad(canonicalStoreId, input.environment)), tokenLast4: token.slice(-4), updatedAt: FieldValue.serverTimestamp(), ...(existing.exists ? {} : { createdAt: FieldValue.serverTimestamp() }) }, { merge: true });
  return { canonicalStoreId, providerId: PROVIDER_ID, environment: input.environment, configured: true, status: 'configured', tokenLast4: token.slice(-4) };
};

export const loadFiscalIssuerCredentialMetadata = async (canonicalStoreIdInput: string, environment: ManagedFiscalIssuerEnvironment): Promise<FiscalIssuerCredentialMetadata | null> => {
  const canonicalStoreId = clean(canonicalStoreIdInput);
  if (!canonicalStoreId) return null;
  const snapshot = await adminDb.doc(`${COLLECTION}/${documentId(canonicalStoreId, environment)}`).get();
  return metadataFrom(snapshot.data());
};

export const markFiscalIssuerCredentialValidation = async (input: { canonicalStoreId: string; environment: ManagedFiscalIssuerEnvironment; ok: boolean; code: string }): Promise<void> => {
  const canonicalStoreId = clean(input.canonicalStoreId);
  if (!canonicalStoreId) throw new Error('FISCAL_ISSUER_STORE_REQUIRED');
  await adminDb.doc(`${COLLECTION}/${documentId(canonicalStoreId, input.environment)}`).set({ status: input.ok ? 'validated' : 'error', lastValidationCode: clean(input.code), lastValidatedAt: FieldValue.serverTimestamp(), updatedAt: FieldValue.serverTimestamp() }, { merge: true });
};
