import { adminDb } from '../firebaseAdmin.js';
import { createHash } from 'node:crypto';
import { authenticateConsultantRequest } from '../ai/consultantAuth.js';
import { resolveCanonicalStoreIdentity } from '../identity/canonicalStoreIdentityService.js';
import type { SubscriptionRenewalProposal } from '../../shared/subscriptionContractRenewal.js';

const validId = (value: unknown): value is string =>
  typeof value === 'string' && /^[a-zA-Z0-9_-]{1,128}$/.test(value);

export type BuyerPrepaidRenewalState = {
  renewalState: 'awaiting_acceptance' | 'accepted' | 'awaiting_payment' |
    'activated' | 'recovery_required' | 'expired';
  contract?: { contractId: string; startsAt: string; expiresAt: string };
};

/** Project only server-persisted evidence; an accepted proposal is not payment proof. */
const loadBuyerRenewalState = async (
  storeId: string, proposalId: string, data: Record<string, unknown>,
  proposal: SubscriptionRenewalProposal,
): Promise<BuyerPrepaidRenewalState> => {
  if (!validId(proposal.previousContractId)) return { renewalState: 'recovery_required' };
  const root = `stores/${storeId}`;
  const [successor, attemptDoc] = await Promise.all([
    adminDb.doc(`${root}/prepaidRenewalSuccessors/${proposal.previousContractId}`).get(),
    adminDb.doc(`${root}/prepaidRenewalPixAttempts/${proposalId}`).get(),
  ]);
  if (successor.exists) {
    const next = successor.data();
    if (!validId(next?.contractId) || typeof next?.providerPaymentId !== 'string' ||
        !/^\d{1,32}$/.test(next.providerPaymentId)) return { renewalState: 'recovery_required' };
    const expectedContractId = 'renewal-' + createHash('sha256').update(
      JSON.stringify([storeId, proposalId, next.providerPaymentId]),
    ).digest('hex');
    if (next.contractId !== expectedContractId) return { renewalState: 'recovery_required' };
    const path = `${root}/prepaidSubscriptionContracts/${next.contractId}`;
    const paymentKey = createHash('sha256').update('mercado_pago:' + next.providerPaymentId).digest('hex');
    const [contractDoc, bindingDoc] = await Promise.all([
      adminDb.doc(path).get(), adminDb.doc(`prepaidRenewalPaymentBindings/${paymentKey}`).get(),
    ]);
    const contract = contractDoc.data();
    const binding = bindingDoc.data();
    if (data.status !== 'accepted' || data.acceptedBy !== proposal.customerId ||
        !contractDoc.exists || !bindingDoc.exists ||
        contract?.storeId !== storeId || contract.customerId !== proposal.customerId ||
        contract.contractId !== next.contractId || contract.previousContractId !== proposal.previousContractId ||
        contract.productId !== proposal.productId || contract.months !== proposal.months ||
        contract.monthlyBasePriceMinor !== proposal.currentMonthlyPriceMinor ||
        contract.discountPercent !== proposal.discountPercent ||
        contract.totalPaidMinor !== proposal.totalDueMinor || contract.acceptedAt !== data.acceptedAt ||
        contract.providerPaymentId !== next.providerPaymentId ||
        binding?.provider !== 'mercado_pago' || binding.storeId !== storeId ||
        binding.contractId !== next.contractId || binding.contractPath !== path ||
        binding.providerPaymentId !== next.providerPaymentId ||
        typeof contract.startsAt !== 'string' || typeof contract.expiresAt !== 'string' ||
        !Number.isFinite(Date.parse(contract.startsAt)) || !Number.isFinite(Date.parse(contract.expiresAt)) ||
        Date.parse(contract.expiresAt) <= Date.parse(contract.startsAt)) {
      return { renewalState: 'recovery_required' };
    }
    return { renewalState: 'activated', contract: {
      contractId: contract.contractId, startsAt: contract.startsAt, expiresAt: contract.expiresAt,
    } };
  }
  if (data.status === 'awaiting_acceptance') return { renewalState: 'awaiting_acceptance' };
  const attempt = attemptDoc.data();
  if (attemptDoc.exists) {
    if (attempt?.storeId !== storeId || attempt.proposalId !== proposalId ||
        attempt.status !== 'reserved') return { renewalState: 'recovery_required' };
    // An ambiguous POST remains recoverable even after its Pix expiry; never offer a fresh charge.
    if (!attempt.providerPaymentId && ['in_flight', 'outcome_unknown'].includes(attempt.executionState)) {
      return { renewalState: 'recovery_required' };
    }
    if (typeof attempt.providerPaymentId === 'string' && /^\d{1,32}$/.test(attempt.providerPaymentId)) {
      return { renewalState: 'awaiting_payment' };
    }
  }
  const acceptedAt = typeof data.acceptedAt === 'string' ? Date.parse(data.acceptedAt) : NaN;
  return { renewalState: !Number.isFinite(acceptedAt) ? 'recovery_required' :
    acceptedAt + 30 * 60_000 <= Date.now() ? 'expired' : 'accepted' };
};

/**
 * Owner-only, read-only selector for existing prepaid contracts.
 * Never expose customer contracts to an unauthenticated browser or another store.
 */
export const listOwnerPrepaidRenewalContracts = async (input: {
  authorization: string | null | undefined;
  storeId: string;
}): Promise<{ contracts: Array<{
  id: string;
  productId: string;
  customerId: string;
  months: number;
  expiresAt: string;
}> }> => {
  if (!validId(input.storeId)) throw new Error('INVALID_RENEWAL_STORE_ID');
  const actor = await authenticateConsultantRequest(input.authorization);
  const identity = await resolveCanonicalStoreIdentity(input.storeId, {
    requirePublishedTenant: true,
  });
  if (identity.canonicalStoreId !== input.storeId || identity.ownerUserId !== actor.uid) {
    throw new Error('RENEWAL_SELLER_NOT_AUTHORIZED');
  }
  const snapshot = await adminDb.collection(
    `stores/${input.storeId}/prepaidSubscriptionContracts`
  ).limit(100).get();
  return {
    contracts: snapshot.docs.flatMap(doc => {
      const data = doc.data();
      if (!validId(doc.id) || !validId(data.productId) ||
          !validId(data.customerId) || ![3, 6, 12].includes(data.months) ||
          typeof data.expiresAt !== 'string' ||
          !Number.isFinite(Date.parse(data.expiresAt))) return [];
      return [{
        id: doc.id,
        productId: data.productId,
        customerId: data.customerId,
        months: data.months,
        expiresAt: data.expiresAt,
      }];
    }),
  };
};

/** Buyer-only read: never return another customer's proposals. */
export const listBuyerPrepaidRenewalProposals = async (input: {
  authorization: string | null | undefined;
  storeId: string;
}): Promise<{ proposals: Array<{
  id: string;
  status: 'awaiting_acceptance' | 'accepted';
  proposal: SubscriptionRenewalProposal;
} & BuyerPrepaidRenewalState> }> => {
  if (!validId(input.storeId)) throw new Error('INVALID_RENEWAL_STORE_ID');
  const buyer = await authenticateConsultantRequest(input.authorization);
  const identity = await resolveCanonicalStoreIdentity(input.storeId, {
    requirePublishedTenant: true,
  });
  if (identity.canonicalStoreId !== input.storeId) {
    throw new Error('INVALID_RENEWAL_STORE_ID');
  }
  const snapshot = await adminDb.collection(
    `stores/${input.storeId}/prepaidRenewalProposals`
  ).where('proposal.customerId', '==', buyer.uid).limit(100).get();
  const rows = await Promise.all(snapshot.docs.map(async doc => {
      const data = doc.data();
      const proposal = data.proposal as SubscriptionRenewalProposal | undefined;
      if (!/^[a-f0-9]{64}$/.test(doc.id) ||
          !proposal || proposal.customerId !== buyer.uid ||
          proposal.storeId !== input.storeId ||
          ![3, 6, 12].includes(proposal.months) ||
          !Number.isSafeInteger(proposal.totalDueMinor) ||
          proposal.totalDueMinor <= 0 ||
          !['awaiting_acceptance', 'accepted'].includes(data.status)) return [];
      return [{
        id: doc.id,
        status: data.status as 'awaiting_acceptance' | 'accepted',
        proposal,
        ...await loadBuyerRenewalState(input.storeId, doc.id, data, proposal),
      }];
    }));
  return { proposals: rows.flat() };
};
