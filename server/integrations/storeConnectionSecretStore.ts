import { FieldValue } from 'firebase-admin/firestore';
import { adminDb } from '../firebaseAdmin.js';
import {
  decryptIntegrationSecret,
  encryptIntegrationSecret,
  getIntegrationMasterKey,
  type EncryptedSecretEnvelope,
} from './secretVault.js';

export interface MercadoLivreTokenSecret {
  accessToken: string;
  refreshToken: string;
  tokenType: string;
  scope: string;
  expiresAtMillis: number;
  externalAccountId: string;
}

interface StoredConnectionSecretDocument {
  provider: 'mercado_livre';
  storeId: string;
  encryptedSecret: EncryptedSecretEnvelope;
}

const connectionSecretPath = (storeId: string): string =>
  `stores/${storeId}/integrationSecrets/mercado_livre`;

const aad = (storeId: string): string => `store:${storeId}:mercado_livre`;

const required = (value: string, code: string): string => {
  const normalized = value.trim();
  if (!normalized) throw new Error(code);
  return normalized;
};

export const mercadoLivreCredentialReference = (storeIdInput: string): string => {
  const storeId = required(storeIdInput, 'STORE_CONNECTION_STORE_REQUIRED');
  return `vault://stores/${encodeURIComponent(storeId)}/mercado_livre`;
};

export const saveMercadoLivreTokenSecret = async (input: {
  storeId: string;
  secret: MercadoLivreTokenSecret;
}): Promise<void> => {
  const storeId = required(input.storeId, 'STORE_CONNECTION_STORE_REQUIRED');
  required(input.secret.accessToken, 'MERCADO_LIVRE_ACCESS_TOKEN_REQUIRED');
  required(input.secret.refreshToken, 'MERCADO_LIVRE_REFRESH_TOKEN_REQUIRED');
  required(input.secret.externalAccountId, 'MERCADO_LIVRE_ACCOUNT_REQUIRED');
  if (!Number.isSafeInteger(input.secret.expiresAtMillis) || input.secret.expiresAtMillis <= Date.now()) {
    throw new Error('MERCADO_LIVRE_TOKEN_EXPIRY_INVALID');
  }

  const encryptedSecret = encryptIntegrationSecret(
    input.secret,
    getIntegrationMasterKey(),
    aad(storeId)
  );
  await adminDb.doc(connectionSecretPath(storeId)).set({
    provider: 'mercado_livre',
    storeId,
    encryptedSecret,
    updatedAt: FieldValue.serverTimestamp(),
  }, { merge: true });
};

export const loadMercadoLivreTokenSecret = async (
  storeIdInput: string
): Promise<MercadoLivreTokenSecret | null> => {
  const storeId = required(storeIdInput, 'STORE_CONNECTION_STORE_REQUIRED');
  const snapshot = await adminDb.doc(connectionSecretPath(storeId)).get();
  if (!snapshot.exists) return null;
  const data = snapshot.data() as StoredConnectionSecretDocument;
  if (data.provider !== 'mercado_livre' || data.storeId !== storeId || !data.encryptedSecret) {
    throw new Error('STORE_CONNECTION_SECRET_SCOPE_INVALID');
  }
  const secret = decryptIntegrationSecret<MercadoLivreTokenSecret>(
    data.encryptedSecret,
    getIntegrationMasterKey(),
    aad(storeId)
  );
  required(secret.accessToken, 'MERCADO_LIVRE_ACCESS_TOKEN_REQUIRED');
  required(secret.refreshToken, 'MERCADO_LIVRE_REFRESH_TOKEN_REQUIRED');
  required(secret.externalAccountId, 'MERCADO_LIVRE_ACCOUNT_REQUIRED');
  return secret;
};
