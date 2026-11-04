import { createHash } from 'node:crypto';
import { buildPrepaidRenewalPixRequest } from './prepaidRenewalPixRequest.js';

export type PrepaidRenewalPixAttempt = {
  proposalId: string;
  storeId: string;
  idempotencyKey: string;
  requestDigest: string;
  expiresAt: string;
  status: 'reserved';
  /** Persisted execution gate; legacy attempts without this field fail closed. */
  executionState?: 'idle' | 'in_flight' | 'outcome_unknown';
  /** Immutable Mercado Pago ID, populated only after a validated server-side creation response. */
  providerPaymentId?: string;
};

type PixRequest = ReturnType<typeof buildPrepaidRenewalPixRequest>;

/**
 * Pure transactional reservation decision. The caller MUST run this inside a
 * Firestore transaction against a unique proposal-scoped document, creating
 * the reservation only if absent. No Mercado Pago request is performed here.
 */
export const decidePrepaidRenewalPixAttempt = (input: {
  storeId: string;
  proposalId: string;
  request: PixRequest;
  existing: PrepaidRenewalPixAttempt | null;
}): { action: 'create' | 'reuse'; attempt: PrepaidRenewalPixAttempt } => {
  const { storeId, proposalId, request, existing } = input;
  if (!/^[a-zA-Z0-9_-]{1,128}$/.test(storeId) ||
      !/^[a-f0-9]{64}$/.test(proposalId) ||
      request.path !== '/v1/payments' || request.init.method !== 'POST') {
    throw new Error('RENEWAL_PIX_ATTEMPT_INVALID');
  }
  let body: Record<string, unknown>;
  try { body = JSON.parse(request.init.body); }
  catch { throw new Error('RENEWAL_PIX_ATTEMPT_INVALID'); }
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    throw new Error('RENEWAL_PIX_ATTEMPT_INVALID');
  }
  const metadata = body.metadata as Record<string, unknown> | undefined;
  const expectedReference = `kyrub:prepaid-renewal:${storeId}:${proposalId}`;
  const idempotencyKey = `prepaid-renewal-${proposalId}`;
  if (request.init.headers['X-Idempotency-Key'] !== idempotencyKey ||
      body.external_reference !== expectedReference ||
      metadata?.kyrub_store_id !== storeId ||
      metadata?.kyrub_prepaid_renewal_proposal_id !== proposalId ||
      typeof body.date_of_expiration !== 'string' ||
      !Number.isFinite(Date.parse(body.date_of_expiration))) {
    throw new Error('RENEWAL_PIX_ATTEMPT_INVALID');
  }
  const requestDigest = createHash('sha256').update(request.init.body).digest('hex');
  const candidate: PrepaidRenewalPixAttempt = {
    proposalId, storeId, idempotencyKey, requestDigest,
    expiresAt: body.date_of_expiration, status: 'reserved',
  };
  if (!existing) {
    if (Date.parse(candidate.expiresAt) <= Date.now()) {
      throw new Error('RENEWAL_PIX_ATTEMPT_EXPIRED');
    }
    return { action: 'create', attempt: candidate };
  }
  if (existing.storeId !== storeId || existing.proposalId !== proposalId ||
      existing.idempotencyKey !== idempotencyKey ||
      existing.requestDigest !== requestDigest ||
      existing.expiresAt !== candidate.expiresAt ||
      existing.status !== 'reserved') {
    throw new Error('RENEWAL_PIX_ATTEMPT_CONFLICT');
  }
  if (Date.parse(existing.expiresAt) <= Date.now() &&
      (existing.providerPaymentId === undefined ||
       !/^[0-9]{1,32}$/.test(existing.providerPaymentId))) {
    throw new Error('RENEWAL_PIX_ATTEMPT_EXPIRED');
  }
  return { action: 'reuse', attempt: existing };
};
