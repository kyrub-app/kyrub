import type { EncryptedSecretEnvelope } from '../integrations/secretVault.js';

export const STORE_OWNED_PIX_PROVIDER = 'store-pix' as const;

const clean = (value: unknown, max = 254): string =>
  typeof value === 'string' ? value.trim().slice(0, max) : '';

const encodedProviderPaymentId = (providerPaymentIdInput: string): string => {
  const providerPaymentId = clean(providerPaymentIdInput, 220);
  if (!providerPaymentId) throw new Error('LOCAL_STORE_PIX_BINDING_ID_REQUIRED');
  return Buffer.from(providerPaymentId, 'utf8').toString('base64url');
};

export const storeOwnedPixPaymentBindingPath = (
  canonicalStoreIdInput: string,
  providerPaymentIdInput: string
): string => {
  const canonicalStoreId = clean(canonicalStoreIdInput, 180);
  if (!canonicalStoreId || canonicalStoreId.includes('/')) {
    throw new Error('LOCAL_STORE_PIX_BINDING_STORE_INVALID');
  }
  return `stores/${canonicalStoreId}/paymentProviderBindings/store-pix__${encodedProviderPaymentId(providerPaymentIdInput)}`;
};

export const storeOwnedPixPaymentBindingAad = (input: {
  canonicalStoreId: string;
  providerPaymentId: string;
}): string =>
  `store:${clean(input.canonicalStoreId, 180)}:store-pix:payment:${clean(input.providerPaymentId, 220)}`;

export interface StoreOwnedPixPaymentBindingDocument {
  schemaVersion: 1;
  provider: 'store-pix';
  canonicalStoreId: string;
  legacyStoreId: string;
  paymentIntentId: string;
  paymentId: string;
  providerPaymentId: string;
  encryptedConfiguration: EncryptedSecretEnvelope;
  createdAt: string;
}

export const parseStoreOwnedPixPaymentBinding = (
  value: unknown,
  expected: {
    canonicalStoreId: string;
    legacyStoreId: string;
    paymentIntentId: string;
    paymentId: string;
    providerPaymentId: string;
  }
): StoreOwnedPixPaymentBindingDocument => {
  const record = value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
  const envelope = record.encryptedConfiguration;
  if (
    record.schemaVersion !== 1 ||
    record.provider !== STORE_OWNED_PIX_PROVIDER ||
    record.canonicalStoreId !== expected.canonicalStoreId ||
    record.legacyStoreId !== expected.legacyStoreId ||
    record.paymentIntentId !== expected.paymentIntentId ||
    record.paymentId !== expected.paymentId ||
    record.providerPaymentId !== expected.providerPaymentId ||
    !envelope || typeof envelope !== 'object' || Array.isArray(envelope) ||
    !clean(record.createdAt)
  ) {
    throw new Error('LOCAL_STORE_PIX_BINDING_CONFLICT');
  }
  return record as unknown as StoreOwnedPixPaymentBindingDocument;
};
