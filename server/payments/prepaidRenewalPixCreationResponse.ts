import type { buildPrepaidRenewalPixRequest } from './prepaidRenewalPixRequest.js';

type Request = ReturnType<typeof buildPrepaidRenewalPixRequest>;

/**
 * Pure validation of a trusted Mercado Pago POST /v1/payments response.
 * This is not an executor: it does not issue network requests or persist IDs.
 * Only a server-owned transport response may be supplied to this function.
 */
export const validatePrepaidRenewalPixCreationResponse = (input: {
  request: Request;
  response: unknown;
  expectedStoreId: string;
  expectedProposalId: string;
  expectedCollectorId: string;
}): string => {
  const { request, response, expectedStoreId, expectedProposalId, expectedCollectorId } = input;
  if (!response || typeof response !== 'object' || Array.isArray(response) ||
      !/^\d+$/.test(expectedCollectorId) ||
      !/^[a-zA-Z0-9_-]{1,128}$/.test(expectedStoreId) ||
      !/^[a-f0-9]{64}$/.test(expectedProposalId)) {
    throw new Error('RENEWAL_PIX_CREATION_RESPONSE_MISMATCH');
  }
  let body: Record<string, unknown>;
  try { body = JSON.parse(request.init.body); }
  catch { throw new Error('RENEWAL_PIX_CREATION_RESPONSE_MISMATCH'); }
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    throw new Error('RENEWAL_PIX_CREATION_RESPONSE_MISMATCH');
  }
  const result = response as Record<string, unknown>;
  const metadata = body.metadata as Record<string, unknown> | undefined;
  const rawId = result.id;
  const id = typeof rawId === 'string' ||
    (typeof rawId === 'number' && Number.isSafeInteger(rawId))
    ? String(rawId) : '';
  const amount = result.transaction_amount;
  const cents = typeof amount === 'number' ? amount * 100 : NaN;
  if (request.path !== '/v1/payments' || request.init.method !== 'POST' ||
      request.init.headers['X-Idempotency-Key'] !== `prepaid-renewal-${expectedProposalId}` ||
      metadata?.kyrub_store_id !== expectedStoreId ||
      metadata?.kyrub_prepaid_renewal_proposal_id !== expectedProposalId ||
      body.external_reference !== `kyrub:prepaid-renewal:${expectedStoreId}:${expectedProposalId}` ||
      !/^\d{1,32}$/.test(id) ||
      !['pending', 'in_process', 'approved'].includes(String(result.status)) ||
      result.payment_method_id !== 'pix' ||
      result.currency_id !== 'BRL' ||
      !((typeof result.collector_id === 'string' ||
          (typeof result.collector_id === 'number' && Number.isSafeInteger(result.collector_id))) &&
        String(result.collector_id) === expectedCollectorId) ||
      result.external_reference !== body.external_reference ||
      (result.metadata != null && (
        typeof result.metadata !== 'object' ||
        (result.metadata as Record<string, unknown>).kyrub_store_id !== expectedStoreId ||
        (result.metadata as Record<string, unknown>).kyrub_prepaid_renewal_proposal_id !== expectedProposalId
      )) ||
      !Number.isSafeInteger(Math.round(cents)) ||
      Math.abs(cents - Math.round(cents)) > 1e-6 ||
      cents !== Number(body.transaction_amount) * 100) {
    throw new Error('RENEWAL_PIX_CREATION_RESPONSE_MISMATCH');
  }
  return id;
};
