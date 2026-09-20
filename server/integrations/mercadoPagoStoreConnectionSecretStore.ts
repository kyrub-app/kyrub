import { FieldValue } from 'firebase-admin/firestore';
import { adminDb } from '../firebaseAdmin.js';
import {
  decryptIntegrationSecret,
  encryptIntegrationSecret,
  getIntegrationMasterKey,
  type EncryptedSecretEnvelope,
} from './secretVault.js';

export interface MercadoPagoStoreTokenSecret {
  accessToken: string;
  refreshToken: string;
  tokenType: string;
  scope: string;
  expiresAtMillis: number;
  externalAccountId: string;
}

interface StoredMercadoPagoSecretDocument {
  provider: 'mercado_pago';
  storeId: string;
  encryptedSecret: EncryptedSecretEnvelope;
}

const required = (value: unknown, code: string): string => {
  const normalized = typeof value === 'string' ? value.trim() : '';
  if (!normalized) throw new Error(code);
  return normalized;
};

const secretPath = (storeId: string): string =>
  `stores/${storeId}/integrationSecrets/mercado_pago_payments`;
const connectionPath = (storeId: string): string =>
  `stores/${storeId}/paymentProviderConnections/mercado_pago`;
const aad = (storeId: string): string => `store:${storeId}:mercado_pago:payments`;

export const mercadoPagoStoreCredentialReference = (storeIdInput: string): string => {
  const storeId = required(storeIdInput, 'MERCADO_PAGO_STORE_REQUIRED');
  return `vault://stores/${encodeURIComponent(storeId)}/mercado_pago_payments`;
};

export const saveMercadoPagoStoreTokenSecret = async (input: {
  storeId: string;
  connectedByUserId: string;
  secret: MercadoPagoStoreTokenSecret;
}): Promise<void> => {
  const storeId = required(input.storeId, 'MERCADO_PAGO_STORE_REQUIRED');
  const connectedByUserId = required(input.connectedByUserId, 'MERCADO_PAGO_CONNECTED_BY_REQUIRED');
  const accessToken = required(input.secret.accessToken, 'MERCADO_PAGO_ACCESS_TOKEN_REQUIRED');
  const refreshToken = required(input.secret.refreshToken, 'MERCADO_PAGO_REFRESH_TOKEN_REQUIRED');
  const externalAccountId = required(input.secret.externalAccountId, 'MERCADO_PAGO_ACCOUNT_REQUIRED');
  if (!Number.isSafeInteger(input.secret.expiresAtMillis) || input.secret.expiresAtMillis <= Date.now()) {
    throw new Error('MERCADO_PAGO_TOKEN_EXPIRY_INVALID');
  }

  const encryptedSecret = encryptIntegrationSecret(
    { ...input.secret, accessToken, refreshToken, externalAccountId },
    getIntegrationMasterKey(),
    aad(storeId)
  );
  const now = FieldValue.serverTimestamp();
  await Promise.all([
    adminDb.doc(secretPath(storeId)).set({
      provider: 'mercado_pago',
      storeId,
      encryptedSecret,
      updatedAt: now,
    }, { merge: true }),
    adminDb.doc(connectionPath(storeId)).set({
      provider: 'mercado_pago',
      scope: 'store',
      storeId,
      status: 'connected',
      externalAccountId,
      connectedByUserId,
      credentialAuthority: 'vault',
      credentialReference: mercadoPagoStoreCredentialReference(storeId),
      expiresAtMillis: input.secret.expiresAtMillis,
      updatedAt: now,
      createdAt: now,
    }, { merge: true }),
  ]);
};

export const loadMercadoPagoStoreTokenSecret = async (
  storeIdInput: string
): Promise<MercadoPagoStoreTokenSecret | null> => {
  const storeId = required(storeIdInput, 'MERCADO_PAGO_STORE_REQUIRED');
  const snapshot = await adminDb.doc(secretPath(storeId)).get();
  if (!snapshot.exists) return null;
  const data = snapshot.data() as StoredMercadoPagoSecretDocument;
  if (data.provider !== 'mercado_pago' || data.storeId !== storeId || !data.encryptedSecret) {
    throw new Error('MERCADO_PAGO_STORE_SECRET_SCOPE_INVALID');
  }
  const secret = decryptIntegrationSecret<MercadoPagoStoreTokenSecret>(
    data.encryptedSecret,
    getIntegrationMasterKey(),
    aad(storeId)
  );
  required(secret.accessToken, 'MERCADO_PAGO_ACCESS_TOKEN_REQUIRED');
  required(secret.refreshToken, 'MERCADO_PAGO_REFRESH_TOKEN_REQUIRED');
  required(secret.externalAccountId, 'MERCADO_PAGO_ACCOUNT_REQUIRED');
  return secret;
};

export const loadMercadoPagoStoreConnectionMetadata = async (storeIdInput: string) => {
  const storeId = required(storeIdInput, 'MERCADO_PAGO_STORE_REQUIRED');
  const snapshot = await adminDb.doc(connectionPath(storeId)).get();
  if (!snapshot.exists) return null;
  const data = snapshot.data() as Record<string, unknown>;
  if (data.provider !== 'mercado_pago' || data.storeId !== storeId) {
    throw new Error('MERCADO_PAGO_STORE_CONNECTION_SCOPE_INVALID');
  }
  return {
    provider: 'mercado_pago' as const,
    status: data.status === 'connected' ? 'connected' as const : 'disconnected' as const,
    externalAccountId: typeof data.externalAccountId === 'string' ? data.externalAccountId : '',
    expiresAtMillis: typeof data.expiresAtMillis === 'number' ? data.expiresAtMillis : 0,
  };
};

export const disconnectMercadoPagoStore = async (storeIdInput: string): Promise<void> => {
  const storeId = required(storeIdInput, 'MERCADO_PAGO_STORE_REQUIRED');
  const batch = adminDb.batch();
  batch.delete(adminDb.doc(secretPath(storeId)));
  batch.set(adminDb.doc(connectionPath(storeId)), {
    provider: 'mercado_pago',
    scope: 'store',
    storeId,
    status: 'disconnected',
    externalAccountId: '',
    expiresAtMillis: 0,
    credentialAuthority: 'vault',
    credentialReference: mercadoPagoStoreCredentialReference(storeId),
    updatedAt: FieldValue.serverTimestamp(),
  }, { merge: true });
  await batch.commit();
};
