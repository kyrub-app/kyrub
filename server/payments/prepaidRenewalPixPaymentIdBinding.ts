import { adminDb } from '../firebaseAdmin.js';
import type { PrepaidRenewalPixAttempt } from './prepaidRenewalPixAttempt.js';

/**
 * Internal-only persistence primitive for a payment ID obtained from a trusted
 * Mercado Pago creation response. NOT a public route or a payment executor.
 * Do not expose to callers that can supply an arbitrary payment ID.
 */
export const bindCreatedPrepaidRenewalPixPaymentId = async (input: {
  storeId: string;
  proposalId: string;
  paymentId: string;
  expectedRequestDigest: string;
}): Promise<'bound' | 'already_bound'> => {
  if (!/^[a-zA-Z0-9_-]{1,128}$/.test(input.storeId) ||
      !/^[a-f0-9]{64}$/.test(input.proposalId) ||
      !/^\\d{1,32}$/.test(input.paymentId) ||
      !/^[a-f0-9]{64}$/.test(input.expectedRequestDigest)) {
    throw new Error('RENEWAL_PIX_PAYMENT_BINDING_INVALID');
  }
  const ref = adminDb.doc(
    `stores/${input.storeId}/prepaidRenewalPixAttempts/${input.proposalId}`
  );
  return adminDb.runTransaction(async tx => {
    const snapshot = await tx.get(ref);
    const attempt = snapshot.data() as (PrepaidRenewalPixAttempt & {
      providerPaymentId?: string;
    }) | undefined;
    if (!snapshot.exists || !attempt ||
        attempt.storeId !== input.storeId ||
        attempt.proposalId !== input.proposalId ||
        attempt.status !== 'reserved' ||
        attempt.idempotencyKey !== `prepaid-renewal-${input.proposalId}` ||
        attempt.requestDigest !== input.expectedRequestDigest) {
      throw new Error('RENEWAL_PIX_PAYMENT_BINDING_CONFLICT');
    }
    if (attempt.providerPaymentId !== undefined) {
      if (attempt.providerPaymentId !== input.paymentId) {
        throw new Error('RENEWAL_PIX_PAYMENT_BINDING_CONFLICT');
      }
      return 'already_bound';
    }
    tx.update(ref, { providerPaymentId: input.paymentId });
    return 'bound';
  });
};
