import { FieldValue } from 'firebase-admin/firestore';
import { adminDb } from '../firebaseAdmin.js';

export interface PaymentProviderBinding {
  provider: 'mercado-pago';
  providerPaymentId: string;
  legacyStoreId: string;
  canonicalStoreId: string;
  paymentId: string;
  paymentIntentId: string;
}

const clean = (value: unknown): string => typeof value === 'string' ? value.trim() : '';
const bindingId = (providerPaymentId: string): string =>
  `mercado-pago__${Buffer.from(providerPaymentId).toString('base64url')}`;

export const saveMercadoPagoPaymentProviderBinding = async (
  input: PaymentProviderBinding
): Promise<void> => {
  const providerPaymentId = clean(input.providerPaymentId);
  const legacyStoreId = clean(input.legacyStoreId);
  const canonicalStoreId = clean(input.canonicalStoreId);
  const paymentId = clean(input.paymentId);
  const paymentIntentId = clean(input.paymentIntentId);
  if (!providerPaymentId || !legacyStoreId || !canonicalStoreId || !paymentId || !paymentIntentId) {
    throw new Error('PAYMENT_PROVIDER_BINDING_SCOPE_REQUIRED');
  }
  const reference = adminDb.doc(`paymentProviderBindings/${bindingId(providerPaymentId)}`);
  await adminDb.runTransaction(async transaction => {
    const snapshot = await transaction.get(reference);
    if (snapshot.exists) {
      const current = snapshot.data() as Record<string, unknown>;
      if (
        current.provider !== 'mercado-pago' ||
        clean(current.providerPaymentId) !== providerPaymentId ||
        clean(current.legacyStoreId) !== legacyStoreId ||
        clean(current.canonicalStoreId) !== canonicalStoreId ||
        clean(current.paymentId) !== paymentId ||
        clean(current.paymentIntentId) !== paymentIntentId
      ) {
        throw new Error('PAYMENT_PROVIDER_BINDING_CONFLICT');
      }
      return;
    }
    transaction.create(reference, {
      provider: 'mercado-pago',
      providerPaymentId,
      legacyStoreId,
      canonicalStoreId,
      paymentId,
      paymentIntentId,
      createdAt: FieldValue.serverTimestamp(),
    });
  });
};

export const loadMercadoPagoPaymentProviderBinding = async (
  providerPaymentIdInput: string
): Promise<PaymentProviderBinding | null> => {
  const providerPaymentId = clean(providerPaymentIdInput);
  if (!providerPaymentId) return null;
  const snapshot = await adminDb.doc(`paymentProviderBindings/${bindingId(providerPaymentId)}`).get();
  if (!snapshot.exists) return null;
  const data = snapshot.data() as Record<string, unknown>;
  const result: PaymentProviderBinding = {
    provider: 'mercado-pago',
    providerPaymentId: clean(data.providerPaymentId),
    legacyStoreId: clean(data.legacyStoreId),
    canonicalStoreId: clean(data.canonicalStoreId),
    paymentId: clean(data.paymentId),
    paymentIntentId: clean(data.paymentIntentId),
  };
  if (
    data.provider !== 'mercado-pago' ||
    result.providerPaymentId !== providerPaymentId ||
    !result.legacyStoreId ||
    !result.canonicalStoreId ||
    !result.paymentId ||
    !result.paymentIntentId
  ) {
    throw new Error('PAYMENT_PROVIDER_BINDING_INVALID');
  }
  return result;
};
