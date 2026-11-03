import { createHash } from 'node:crypto';
import { adminDb } from '../firebaseAdmin.js';
import {
  decidePrepaidRenewalPixAttempt,
  type PrepaidRenewalPixAttempt,
} from './prepaidRenewalPixAttempt.js';
import { buildPrepaidRenewalPixRequest } from './prepaidRenewalPixRequest.js';

/**
 * Server-only reservation. This module is NOT an HTTP endpoint and MUST NOT
 * be invoked in production until the isolated emulator tests and explicit
 * payment-executor review are complete. It never calls Mercado Pago.
 *
 * Firestore transactions serialize conflicting creates at the unique
 * proposal-scoped document. The caller must have authenticated the buyer,
 * loaded the immutable accepted proposal and resolved seller OAuth authority.
 */
export const reservePrepaidRenewalPixAttempt = async (input: {
  storeId: string;
  proposalId: string;
  request: ReturnType<typeof buildPrepaidRenewalPixRequest>;
}): Promise<{ action: 'create' | 'reuse'; attempt: PrepaidRenewalPixAttempt }> => {
  const { storeId, proposalId, request } = input;
  if (!/^[a-zA-Z0-9_-]{1,128}$/.test(storeId) ||
      !/^[a-f0-9]{64}$/.test(proposalId)) {
    throw new Error('RENEWAL_PIX_ATTEMPT_INVALID');
  }
  const proposalRef = adminDb.doc(
    `stores/${storeId}/prepaidRenewalProposals/${proposalId}`
  );
  const attemptRef = adminDb.doc(
    `stores/${storeId}/prepaidRenewalPixAttempts/${proposalId}`
  );
  return adminDb.runTransaction(async tx => {
    const [proposalSnapshot, attemptSnapshot] = await Promise.all([
      tx.get(proposalRef), tx.get(attemptRef),
    ]);
    const proposal = proposalSnapshot.data() as Record<string, unknown> | undefined;
    if (!proposalSnapshot.exists || proposal?.status !== 'accepted' ||
        proposal.paymentExternalReference !==
          `kyrub:prepaid-renewal:${storeId}:${proposalId}` ||
        typeof proposal.acceptedBy !== 'string' ||
        !proposal.acceptedBy) {
      throw new Error('RENEWAL_PIX_ACCEPTANCE_REQUIRED');
    }
    const acceptance = proposal.acceptance as Record<string, unknown> | undefined;
    const embeddedProposal = proposal.proposal as Record<string, unknown> | undefined;
    if (typeof proposal.acceptedProposalDigest !== 'string' ||
        proposal.acceptedProposalDigest !== createHash('sha256').update(JSON.stringify(embeddedProposal)).digest('hex') ||
        proposal.acceptedAt !== acceptance?.acceptedAt ||
        acceptance?.customerId !== proposal.acceptedBy ||
        acceptance?.storeId !== storeId ||
        embeddedProposal?.storeId !== storeId ||
        embeddedProposal?.customerId !== proposal.acceptedBy ||
        acceptance?.acceptedTotalMinor !== embeddedProposal?.totalDueMinor ||
        !Number.isSafeInteger(acceptance?.acceptedTotalMinor) ||
        typeof acceptance?.acceptedAt !== 'string') {
      throw new Error('RENEWAL_PIX_ACCEPTANCE_REQUIRED');
    }
    let payload: Record<string, unknown>;
    try { payload = JSON.parse(request.init.body); }
    catch { throw new Error('RENEWAL_PIX_ATTEMPT_INVALID'); }
    if (payload.transaction_amount !== Number(acceptance.acceptedTotalMinor) / 100 ||
        payload.date_of_expiration !==
          new Date(Date.parse(acceptance.acceptedAt) + 30 * 60_000).toISOString()) {
      throw new Error('RENEWAL_PIX_ATTEMPT_INVALID');
    }
    const result = decidePrepaidRenewalPixAttempt({
      storeId, proposalId, request,
      existing: attemptSnapshot.exists
        ? attemptSnapshot.data() as PrepaidRenewalPixAttempt : null,
    });
    if (result.action === 'create') tx.create(attemptRef, result.attempt);
    return result;
  });
};

/**
 * Authenticated entrypoint. The caller supplies only a bearer token and
 * proposal locator, never a seller token, amount, buyer identity or Pix body.
 * Still internal-only: no HTTP route or Mercado Pago execution is exposed.
 */
export const reserveAuthenticatedPrepaidRenewalPixAttempt = async (input: {
  authorization: string | null | undefined;
  storeId: string;
  proposalId: string;
}) => {
  const { prepareAuthenticatedPrepaidRenewalPix } =
    await import('./prepaidRenewalCheckoutPreparation.js');
  const request = await prepareAuthenticatedPrepaidRenewalPix(input);
  return reservePrepaidRenewalPixAttempt({
    storeId: input.storeId, proposalId: input.proposalId, request,
  });
};
