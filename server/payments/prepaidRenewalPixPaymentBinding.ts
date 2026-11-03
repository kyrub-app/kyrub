import { createHash } from 'node:crypto';
import type { PrepaidRenewalPixAttempt } from './prepaidRenewalPixAttempt.js';

/**
 * Pure reconciliation gate for an already reserved Pix request. It never
 * treats a provider payment as valid on its own: upstream must independently
 * verify the payment directly against the seller's Mercado Pago OAuth account.
 */
export const assertVerifiedPrepaidRenewalPixAttempt = (input: {
  storeId: string;
  proposalId: string;
  acceptedAt: string;
  acceptedTotalMinor: number;
  paymentId: string;
  paymentApprovedAt: string;
  verifiedPaymentAmountMinor: number;
  attempt: (PrepaidRenewalPixAttempt & { providerPaymentId?: string }) | null;
}): void => {
  const { storeId, proposalId, attempt } = input;
  if (!attempt ||
      attempt.storeId !== storeId || attempt.proposalId !== proposalId ||
      attempt.status !== 'reserved' ||
      // The future isolated payment executor must atomically persist the ID
      // returned by Mercado Pago. A mere reservation is not proof of payment.
      attempt.providerPaymentId !== input.paymentId ||
      attempt.idempotencyKey !== `prepaid-renewal-${proposalId}` ||
      !/^[a-f0-9]{64}$/.test(attempt.requestDigest) ||
      !/^\d{1,32}$/.test(input.paymentId) ||
      !Number.isSafeInteger(input.acceptedTotalMinor) ||
      input.acceptedTotalMinor <= 0 ||
      input.verifiedPaymentAmountMinor !== input.acceptedTotalMinor ||
      !Number.isFinite(Date.parse(input.acceptedAt)) ||
      !Number.isFinite(Date.parse(input.paymentApprovedAt)) ||
      attempt.expiresAt !==
        new Date(Date.parse(input.acceptedAt) + 30 * 60_000).toISOString() ||
      Date.parse(input.paymentApprovedAt) < Date.parse(input.acceptedAt)) {
    throw new Error('RENEWAL_PIX_PAYMENT_ATTEMPT_MISMATCH');
  }
};

/** Only a request constructed from a trusted accepted proposal may be hashed. */
export const prepaidRenewalPixRequestDigest = (body: string): string =>
  createHash('sha256').update(body).digest('hex');
