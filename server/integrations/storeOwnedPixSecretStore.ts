import { FieldValue } from 'firebase-admin/firestore';
import { adminDb } from '../firebaseAdmin.js';
import {
  maskStoreOwnedPixKey,
  normalizeStoreOwnedPixConfiguration,
  type StoreOwnedPixConfiguration,
  type StoreOwnedPixKeyType,
} from '../../shared/storeOwnedPix.js';
import {
  decryptIntegrationSecret,
  encryptIntegrationSecret,
  getIntegrationMasterKey,
  type EncryptedSecretEnvelope,
} from './secretVault.js';

interface StoredStoreOwnedPixSecretDocument {
  provider: 'store-pix';
  storeId: string;
  encryptedSecret: EncryptedSecretEnvelope;
}

export interface StoreOwnedPixConnectionMetadata {
  provider: 'store-pix';
  configured: boolean;
  enabled: boolean;
  keyType: StoreOwnedPixKeyType | '';
  maskedKey: string;
  recipientName: string;
  recipientCity: string;
}

const clean = (value: unknown): string =>
  typeof value === 'string' ? value.trim() : '';

const requiredStoreId = (value: unknown): string => {
  const storeId = clean(value);
  if (!storeId || storeId.includes('/')) throw new Error('STORE_PIX_STORE_REQUIRED');
  return storeId;
};

const secretPath = (storeId: string): string =>
  `stores/${storeId}/integrationSecrets/store_pix_receivables`;
const connectionPath = (storeId: string): string =>
  `stores/${storeId}/paymentProviderConnections/store_pix`;
const aad = (storeId: string): string => `store:${storeId}:store_pix:receivables`;

export const storeOwnedPixCredentialReference = (storeIdInput: string): string => {
  const storeId = requiredStoreId(storeIdInput);
  return `vault://stores/${encodeURIComponent(storeId)}/store_pix_receivables`;
};

export const saveStoreOwnedPixConfiguration = async (input: {
  storeId: string;
  configuredByUserId: string;
  value: unknown;
}): Promise<StoreOwnedPixConnectionMetadata> => {
  const storeId = requiredStoreId(input.storeId);
  const configuredByUserId = clean(input.configuredByUserId);
  if (!configuredByUserId) throw new Error('STORE_PIX_CONFIGURED_BY_REQUIRED');
  const configuration = normalizeStoreOwnedPixConfiguration(input.value);
  const encryptedSecret = encryptIntegrationSecret(
    configuration,
    getIntegrationMasterKey(),
    aad(storeId)
  );
  const now = FieldValue.serverTimestamp();
  const metadata: StoreOwnedPixConnectionMetadata = {
    provider: 'store-pix',
    configured: true,
    enabled: configuration.enabled,
    keyType: configuration.keyType,
    maskedKey: maskStoreOwnedPixKey(configuration.keyType, configuration.key),
    recipientName: configuration.recipientName,
    recipientCity: configuration.recipientCity,
  };

  const batch = adminDb.batch();
  batch.set(adminDb.doc(secretPath(storeId)), {
    provider: 'store-pix',
    storeId,
    encryptedSecret,
    updatedAt: now,
  }, { merge: true });
  batch.set(adminDb.doc(connectionPath(storeId)), {
    ...metadata,
    scope: 'store',
    storeId,
    configuredByUserId,
    credentialAuthority: 'vault',
    credentialReference: storeOwnedPixCredentialReference(storeId),
    updatedAt: now,
    createdAt: now,
  }, { merge: true });
  await batch.commit();
  return metadata;
};

export const loadStoreOwnedPixConnectionMetadata = async (
  storeIdInput: string
): Promise<StoreOwnedPixConnectionMetadata> => {
  const storeId = requiredStoreId(storeIdInput);
  const snapshot = await adminDb.doc(connectionPath(storeId)).get();
  if (!snapshot.exists) {
    return {
      provider: 'store-pix',
      configured: false,
      enabled: false,
      keyType: '',
      maskedKey: '',
      recipientName: '',
      recipientCity: '',
    };
  }
  const data = snapshot.data() as Record<string, unknown>;
  if (data.provider !== 'store-pix' || data.storeId !== storeId) {
    throw new Error('STORE_PIX_CONNECTION_SCOPE_INVALID');
  }
  const keyType = data.keyType;
  const normalizedKeyType: StoreOwnedPixKeyType | '' =
    keyType === 'cpf' || keyType === 'cnpj' || keyType === 'email' ||
    keyType === 'phone' || keyType === 'evp'
      ? keyType
      : '';
  return {
    provider: 'store-pix',
    configured: data.configured === true,
    enabled: data.enabled === true,
    keyType: normalizedKeyType,
    maskedKey: clean(data.maskedKey),
    recipientName: clean(data.recipientName),
    recipientCity: clean(data.recipientCity),
  };
};

export const loadStoreOwnedPixConfiguration = async (
  storeIdInput: string,
  options: { requireEnabled?: boolean } = {}
): Promise<StoreOwnedPixConfiguration> => {
  const storeId = requiredStoreId(storeIdInput);
  const [secretSnapshot, metadata] = await Promise.all([
    adminDb.doc(secretPath(storeId)).get(),
    loadStoreOwnedPixConnectionMetadata(storeId),
  ]);
  if (!secretSnapshot.exists || !metadata.configured) {
    throw new Error('STORE_PIX_NOT_CONFIGURED');
  }
  if (options.requireEnabled !== false && !metadata.enabled) {
    throw new Error('STORE_PIX_DISABLED');
  }
  const data = secretSnapshot.data() as StoredStoreOwnedPixSecretDocument;
  if (data.provider !== 'store-pix' || data.storeId !== storeId || !data.encryptedSecret) {
    throw new Error('STORE_PIX_SECRET_SCOPE_INVALID');
  }
  const configuration = normalizeStoreOwnedPixConfiguration(
    decryptIntegrationSecret<StoreOwnedPixConfiguration>(
      data.encryptedSecret,
      getIntegrationMasterKey(),
      aad(storeId)
    )
  );
  return {
    ...configuration,
    enabled: metadata.enabled,
  };
};

export const disableStoreOwnedPixConfiguration = async (
  storeIdInput: string,
  disabledByUserId: string
): Promise<void> => {
  const storeId = requiredStoreId(storeIdInput);
  const actor = clean(disabledByUserId);
  if (!actor) throw new Error('STORE_PIX_CONFIGURED_BY_REQUIRED');
  const metadata = await loadStoreOwnedPixConnectionMetadata(storeId);
  if (!metadata.configured) throw new Error('STORE_PIX_NOT_CONFIGURED');
  await adminDb.doc(connectionPath(storeId)).set({
    provider: 'store-pix',
    scope: 'store',
    storeId,
    configured: true,
    enabled: false,
    disabledByUserId: actor,
    updatedAt: FieldValue.serverTimestamp(),
  }, { merge: true });
};
