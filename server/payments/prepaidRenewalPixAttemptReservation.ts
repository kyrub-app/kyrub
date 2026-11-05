import { createHash } from 'node:crypto';
import { adminDb } from '../firebaseAdmin.js';
import {
  decidePrepaidRenewalPixAttempt,
  type PrepaidRenewalPixAttempt,
} from './prepaidRenewalPixAttempt.js';
import { buildPrepaidRenewalPixRequest } from './prepaidRenewalPixRequest.js';

/** Same collection, separate immutable reservation key shared by competing proposals. */
export const prepaidRenewalPixPredecessorReservationPath = (storeId: string, previousContractId: unknown): string => {
  if (typeof previousContractId !== 'string' || !previousContractId ||
      previousContractId.length > 180 || previousContractId.includes('/')) {
    throw new Error('RENEWAL_PIX_ACCEPTANCE_REQUIRED');
  }
  return `stores/${storeId}/prepaidRenewalPixAttempts/contract_${createHash('sha256').update(previousContractId).digest('hex')}`;
};

/**
 * Server-only reservation. This module is NOT an HTTP endpoint and MUST NOT
 * be invoked in production until the isolated emulator tests and explicit
 * payment-executor review are complete. It never calls Mercado Pago.
 *
 * Firestore transactions serialize conflicting creates at the unique
 * proposal-scoped document and predecessor-scoped reservation. The caller must have authenticated the buyer,
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
    if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
      throw new Error('RENEWAL_PIX_ATTEMPT_INVALID');
    }
    if (payload.transaction_amount !== Number(acceptance.acceptedTotalMinor) / 100 ||
        payload.date_of_expiration !==
          new Date(Date.parse(acceptance.acceptedAt) + 30 * 60_000).toISOString()) {
      throw new Error('RENEWAL_PIX_ATTEMPT_INVALID');
    }
    const previousContractId = embeddedProposal.previousContractId;
    const predecessorReservationRef = adminDb.doc(
      prepaidRenewalPixPredecessorReservationPath(storeId, previousContractId)
    );
    const successorRef = adminDb.doc(`stores/${storeId}/prepaidRenewalSuccessors/${previousContractId}`);
    const [predecessorReservation, successor] = await Promise.all([
      tx.get(predecessorReservationRef), tx.get(successorRef),
    ]);
    const requestDigest = createHash('sha256').update(request.init.body).digest('hex');
    if (predecessorReservation.exists &&
        (predecessorReservation.get('kind') !== 'predecessor_reservation' ||
         predecessorReservation.get('storeId') !== storeId ||
         predecessorReservation.get('previousContractId') !== previousContractId ||
         predecessorReservation.get('proposalId') !== proposalId ||
         predecessorReservation.get('requestDigest') !== requestDigest)) {
      // Never release on expiration or unknown outcome: an earlier Pix may still be payable.
      throw new Error('RENEWAL_PREDECESSOR_PAYMENT_IN_PROGRESS');
    }
    if (successor.exists && (!attemptSnapshot.exists ||
        !attemptSnapshot.get('providerPaymentId') ||
        successor.get('providerPaymentId') !== attemptSnapshot.get('providerPaymentId'))) {
      throw new Error('RENEWAL_PREDECESSOR_ALREADY_RENEWED');
    }
    if (attemptSnapshot.exists && attemptSnapshot.get('requestBody') !== undefined &&
        attemptSnapshot.get('requestBody') !== request.init.body) {
      throw new Error('RENEWAL_PIX_ATTEMPT_CONFLICT');
    }
    const result = decidePrepaidRenewalPixAttempt({
      storeId, proposalId, request,
      existing: attemptSnapshot.exists
        ? attemptSnapshot.data() as PrepaidRenewalPixAttempt : null,
    });
    if (!predecessorReservation.exists) tx.create(predecessorReservationRef, {
      kind: 'predecessor_reservation', storeId, previousContractId, proposalId, requestDigest,
    });
    if (result.action === 'create') tx.create(attemptRef, {
      ...result.attempt, requestBody: request.init.body, executionState: 'idle',
    });
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
