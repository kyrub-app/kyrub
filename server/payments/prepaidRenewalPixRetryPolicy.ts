import { createHash } from 'node:crypto';
import type { PrepaidRenewalPixAttempt } from './prepaidRenewalPixAttempt.js';
import type { buildPrepaidRenewalPixRequest } from './prepaidRenewalPixRequest.js';

/**
 * Pure fail-closed recovery policy for a Pix creation whose HTTP result may
 * have been lost. Never create a new idempotency key for the same proposal.
 * The caller must fetch the attempt from Firestore, not trust client input.
 * No network I/O or payment creation is performed here.
 */
export const decidePrepaidRenewalPixRecovery = (input: {
  storeId: string;
  proposalId: string;
  request: ReturnType<typeof buildPrepaidRenewalPixRequest>;
  persistedAttempt: PrepaidRenewalPixAttempt | null;
}): { action: 'fetch_existing' | 'retry_same_request'; paymentId?: string } => {
  const { storeId, proposalId, request, persistedAttempt: attempt } = input;
  if (!attempt || attempt.storeId !== storeId || attempt.proposalId !== proposalId ||
      attempt.status !== 'reserved' ||
      request.path !== '/v1/payments' || request.init.method !== 'POST' ||
      request.init.headers['X-Idempotency-Key'] !== `prepaid-renewal-${proposalId}` ||
      attempt.idempotencyKey !== `prepaid-renewal-${proposalId}` ||
      attempt.requestDigest !== createHash('sha256').update(request.init.body).digest('hex') ||
      !/^[a-f0-9]{64}$/.test(proposalId) ||
      !/^[a-zA-Z0-9_-]{1,128}$/.test(storeId)) {
    throw new Error('RENEWAL_PIX_RECOVERY_CONFLICT');
  }
  let body: Record<string, unknown>;
  try { body = JSON.parse(request.init.body); }
  catch { throw new Error('RENEWAL_PIX_RECOVERY_CONFLICT'); }
  const metadata = body.metadata as Record<string, unknown> | undefined;
  if (metadata?.kyrub_store_id !== storeId ||
      metadata?.kyrub_prepaid_renewal_proposal_id !== proposalId ||
      body.external_reference !== `kyrub:prepaid-renewal:${storeId}:${proposalId}` ||
      body.date_of_expiration !== attempt.expiresAt) {
    throw new Error('RENEWAL_PIX_RECOVERY_CONFLICT');
  }
  if (attempt.providerPaymentId !== undefined) {
    if (!/^\d{1,32}$/.test(attempt.providerPaymentId)) {
      throw new Error('RENEWAL_PIX_RECOVERY_CONFLICT');
    }
    return { action: 'fetch_existing', paymentId: attempt.providerPaymentId };
  }
  if (!Number.isFinite(Date.parse(attempt.expiresAt)) ||
      Date.parse(attempt.expiresAt) <= Date.now()) {
    throw new Error('RENEWAL_PIX_RECOVERY_EXPIRED_UNBOUND');
  }
  return { action: 'retry_same_request' };
};
