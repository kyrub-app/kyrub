import { FieldValue } from 'firebase-admin/firestore';
import { adminDb } from '../firebaseAdmin.js';
import {
  assertFiscalProductionExecutionAuthorized,
  type FiscalProductionAuthorization,
  type FiscalProductionDocumentFamily,
} from './fiscalProductionAuthorization.js';

const clean = (value: unknown, maxLength = 240): string =>
  typeof value === 'string' ? value.trim().slice(0, maxLength) : '';

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
    throw new Error('FISCAL_PRODUCTION_CANONICAL_STORE_REQUIRED');
  }
  return canonicalStoreId;
};

const currentPath = (canonicalStoreId: string): string =>
  `stores/${canonicalStoreId}/fiscalProductionAuthorization/current`;

const revisionPath = (canonicalStoreId: string, revisionId: string): string =>
  `stores/${canonicalStoreId}/fiscalProductionAuthorizationRevisions/${revisionId}`;

const parseStoredAuthorization = (
  value: unknown,
  canonicalStoreId: string
): FiscalProductionAuthorization => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('FISCAL_PRODUCTION_AUTHORIZATION_STORED_RECORD_INVALID');
  }
  const raw = value as Record<string, unknown>;
  const authorization: FiscalProductionAuthorization = {
    schemaVersion: 1,
    canonicalStoreId,
    documentFamily: raw.documentFamily === 'nfce' ? 'nfce' : 'nfce',
    environment: 'production',
    status: raw.status === 'enabled' ? 'enabled' : 'disabled',
    providerAdapterId: clean(raw.providerAdapterId, 80),
    providerAdapterVersion: clean(raw.providerAdapterVersion, 40),
    credentialSecretRef: clean(raw.credentialSecretRef, 320),
    authorizedByUserId: clean(raw.authorizedByUserId, 160),
    authorizedAt: clean(raw.authorizedAt, 80),
    authority: raw.authority === 'server_owned_fiscal_production_authorization'
      ? 'server_owned_fiscal_production_authorization'
      : 'server_owned_fiscal_production_authorization',
  };
  if (authorization.status === 'enabled') {
    return assertFiscalProductionExecutionAuthorized({
      canonicalStoreId,
      documentFamily: authorization.documentFamily,
      authorization,
    });
  }
  return authorization;
};

export const loadFiscalProductionAuthorization = async (input: {
  tenantId: string;
  requestedByUserId: string;
}): Promise<FiscalProductionAuthorization | null> => {
  const tenantId = clean(input.tenantId, 160);
  const requestedByUserId = clean(input.requestedByUserId, 160);
  const canonicalStoreId = await canonicalStoreIdForOwner(tenantId, requestedByUserId);
  const snapshot = await adminDb.doc(currentPath(canonicalStoreId)).get();
  return snapshot.exists
    ? parseStoredAuthorization(snapshot.data(), canonicalStoreId)
    : null;
};

export interface SaveFiscalProductionAuthorizationInput {
  tenantId: string;
  requestedByUserId: string;
  documentFamily: FiscalProductionDocumentFamily;
  status: 'enabled' | 'disabled';
  providerAdapterId: string;
  providerAdapterVersion: string;
  credentialSecretRef: string;
  now?: Date;
}

/**
 * Server-only persistence boundary for production fiscal authority.
 * This registry never resolves credentials and never calls a fiscal provider.
 */
export const saveFiscalProductionAuthorization = async (
  input: SaveFiscalProductionAuthorizationInput
): Promise<FiscalProductionAuthorization> => {
  const tenantId = clean(input.tenantId, 160);
  const requestedByUserId = clean(input.requestedByUserId, 160);
  const canonicalStoreId = await canonicalStoreIdForOwner(tenantId, requestedByUserId);
  const authorizedAt = (input.now ?? new Date()).toISOString();
  const authorization: FiscalProductionAuthorization = {
    schemaVersion: 1,
    canonicalStoreId,
    documentFamily: input.documentFamily,
    environment: 'production',
    status: input.status,
    providerAdapterId: clean(input.providerAdapterId, 80),
    providerAdapterVersion: clean(input.providerAdapterVersion, 40),
    credentialSecretRef: clean(input.credentialSecretRef, 320),
    authorizedByUserId: requestedByUserId,
    authorizedAt,
    authority: 'server_owned_fiscal_production_authorization',
  };

  if (authorization.status === 'enabled') {
    assertFiscalProductionExecutionAuthorized({
      canonicalStoreId,
      documentFamily: input.documentFamily,
      authorization,
    });
  }

  const revisionId = `${authorizedAt.replace(/[^0-9]/g, '')}-${authorization.status}`;
  const stored = {
    ...authorization,
    serverUpdatedAt: FieldValue.serverTimestamp(),
  };

  await adminDb.runTransaction(async transaction => {
    transaction.set(adminDb.doc(currentPath(canonicalStoreId)), stored);
    transaction.create(adminDb.doc(revisionPath(canonicalStoreId, revisionId)), stored);
  });

  return authorization;
};
