import { createHash } from 'node:crypto';
import { adminDb } from '../firebaseAdmin.js';
import { assertVerifiedPrepaidRenewalPixAttempt } from './prepaidRenewalPixPaymentBinding.js';
import type { PrepaidRenewalPixAttempt } from './prepaidRenewalPixAttempt.js';
import { addMonthsUtc } from './prepaidSubscriptionContractLifecycle.js';
import { assertPrepaidRenewalEntitlementBinding } from './prepaidRenewalEntitlementBinding.js';
import { prepaidRenewalPixPredecessorReservationPath } from './prepaidRenewalPixAttemptReservation.js';
import {
  resolveRenewalPaymentReplay,
  type snapshotAcceptedPrepaidRenewal,
} from '../../shared/subscriptionContractRenewal.js';

type RenewalSnapshot = ReturnType<typeof snapshotAcceptedPrepaidRenewal>;
const safeId = (value: string): boolean =>
  typeof value === 'string' && value.length > 0 && value.length <= 180 && !value.includes('/');
const paymentKey = (value: string): string =>
  createHash('sha256').update('mercado_pago:' + value).digest('hex');

/**
 * Internal persistence boundary. Caller MUST authenticate buyer, verify payment
 * directly with the provider and validate proposal acceptance before calling.
 * The authenticated reconciliation API reaches this helper only through
 * provider verification and accepted-proposal validation. The Firestore
 * transaction enforces payment uniqueness and predecessor successor locking.
 */
export const persistVerifiedPrepaidRenewal = async (renewal: RenewalSnapshot, acceptedProposalId?: string, verifiedSellerCredentialScopeId?: string, verifiedPixPaymentApprovedAt?: string, verifiedSellerExternalAccountId?: string):
  Promise<'created' | 'already_recorded'> => {
  if (![renewal.storeId, renewal.contractId, renewal.previousContractId,
    renewal.customerId, renewal.productId, renewal.providerPaymentId].every(safeId) ||
    !Number.isSafeInteger(renewal.totalPaidMinor) || renewal.totalPaidMinor <= 0 ||
    ![3, 6, 12].includes(renewal.months)) {
    throw new Error('INVALID_RENEWAL_PERSISTENCE_INPUT');
  }
  if (renewal.contractId === renewal.previousContractId ||
      !Number.isSafeInteger(renewal.monthlyBasePriceMinor) ||
      renewal.monthlyBasePriceMinor <= 0 ||
      !Number.isFinite(Date.parse(renewal.acceptedAt)) ||
      !Number.isFinite(Date.parse(renewal.startsAt)) ||
      !Number.isFinite(Date.parse(renewal.expiresAt)) ||
      Date.parse(renewal.expiresAt) <= Date.parse(renewal.startsAt)) {
    throw new Error('INVALID_RENEWAL_PERSISTENCE_INPUT');
  }
  if (acceptedProposalId !== undefined && !/^[a-f0-9]{64}$/.test(acceptedProposalId)) {
    throw new Error('INVALID_RENEWAL_PROPOSAL_ID');
  }
  if (verifiedSellerCredentialScopeId !== undefined && !safeId(verifiedSellerCredentialScopeId)) {
    throw new Error('INVALID_RENEWAL_SELLER_SCOPE');
  }
  if (verifiedPixPaymentApprovedAt !== undefined && (!acceptedProposalId || !Number.isFinite(Date.parse(verifiedPixPaymentApprovedAt)))) {
    throw new Error('INVALID_RENEWAL_PIX_BINDING_INPUT');
  }
  if (verifiedPixPaymentApprovedAt && (!verifiedSellerExternalAccountId || !/^\d+$/.test(verifiedSellerExternalAccountId) ||
      !verifiedSellerCredentialScopeId || !safeId(verifiedSellerCredentialScopeId))) {
    throw new Error('RENEWAL_SELLER_ACCOUNT_NOT_VERIFIED');
  }
  const sellerStoreRef = verifiedPixPaymentApprovedAt ? adminDb.doc(`stores/${renewal.storeId}`) : null;
  const sellerConnectionRef = verifiedPixPaymentApprovedAt
    ? adminDb.doc(`stores/${verifiedSellerCredentialScopeId}/paymentProviderConnections/mercado_pago`) : null;
  const pixAttemptRef = verifiedPixPaymentApprovedAt && acceptedProposalId
    ? adminDb.doc(`stores/${renewal.storeId}/prepaidRenewalPixAttempts/${acceptedProposalId}`) : null;
  const acceptedProposalRef = acceptedProposalId
    ? adminDb.doc(`stores/${renewal.storeId}/prepaidRenewalProposals/${acceptedProposalId}`) : null;
  const predecessorReservationRef = acceptedProposalId
    ? adminDb.doc(prepaidRenewalPixPredecessorReservationPath(renewal.storeId, renewal.previousContractId)) : null;
  const contractRef = adminDb.doc(`stores/${renewal.storeId}/prepaidSubscriptionContracts/${renewal.contractId}`);
  const paymentRef = adminDb.doc(`prepaidRenewalPaymentBindings/${paymentKey(renewal.providerPaymentId)}`);
  const predecessorRef = adminDb.doc(`stores/${renewal.storeId}/prepaidRenewalSuccessors/${renewal.previousContractId}`);
  const originalContractRef = adminDb.doc(`stores/${renewal.storeId}/prepaidSubscriptionContracts/${renewal.previousContractId}`);
  // Read a canonical subscription only when the predecessor carries an explicit ID.
  // Legacy contracts without that ID are not silently mapped by buyer/product.
  return adminDb.runTransaction(async tx => {
    const [contractDoc, paymentDoc, predecessorDoc, originalContractDoc, acceptedProposalDoc, pixAttemptDoc, sellerStoreDoc, sellerConnectionDoc, predecessorReservationDoc] = await Promise.all([
      tx.get(contractRef), tx.get(paymentRef), tx.get(predecessorRef), tx.get(originalContractRef),
      acceptedProposalRef ? tx.get(acceptedProposalRef) : Promise.resolve(null),
      pixAttemptRef ? tx.get(pixAttemptRef) : Promise.resolve(null),
      sellerStoreRef ? tx.get(sellerStoreRef) : Promise.resolve(null),
      sellerConnectionRef ? tx.get(sellerConnectionRef) : Promise.resolve(null),
      predecessorReservationRef ? tx.get(predecessorReservationRef) : Promise.resolve(null),
    ]);
    if (predecessorReservationDoc?.exists &&
        (predecessorReservationDoc.get('kind') !== 'predecessor_reservation' ||
         predecessorReservationDoc.get('storeId') !== renewal.storeId ||
         predecessorReservationDoc.get('previousContractId') !== renewal.previousContractId ||
         predecessorReservationDoc.get('proposalId') !== acceptedProposalId ||
         (pixAttemptDoc?.exists && predecessorReservationDoc.get('requestDigest') !== pixAttemptDoc.get('requestDigest')))) {
      throw new Error('RENEWAL_PREDECESSOR_PAYMENT_IN_PROGRESS');
    }
    if (sellerStoreRef) {
      const store = sellerStoreDoc?.data();
      const connection = sellerConnectionDoc?.data();
      if (!sellerStoreDoc?.exists || !safeId(store?.ownerId) ||
          (store.legacyTenantId || store.ownerId) !== verifiedSellerCredentialScopeId ||
          store.ownerId !== verifiedSellerCredentialScopeId ||
          connection?.provider !== 'mercado_pago' ||
          connection.storeId !== verifiedSellerCredentialScopeId ||
          connection.status !== 'connected' ||
          connection.externalAccountId !== verifiedSellerExternalAccountId) {
        throw new Error('RENEWAL_SELLER_ACCOUNT_NOT_VERIFIED');
      }
    }
    if (acceptedProposalRef) {
      const data = acceptedProposalDoc?.data();
      const proposal = data?.proposal;
      const acceptance = data?.acceptance;
      if (!proposal || !acceptance || data?.status !== 'accepted' ||
          data.acceptedBy !== renewal.customerId ||
          // Proposals created against the canonical store persist its ID,
          // while provider verification resolves the owner's OAuth scope.
          // Canonical-ID normalization is safe only when this transaction has
          // independently checked the current owner and OAuth account above.
          // Internal non-Pix callers retain exact-scope matching; a supplied
          // "verified" scope alone must never authorize the store-ID fallback.
          (data.sellerCredentialScopeId !== (verifiedSellerCredentialScopeId ?? renewal.storeId) &&
           !(sellerStoreRef && data.sellerCredentialScopeId === renewal.storeId)) ||
          data.paymentExternalReference !== `kyrub:prepaid-renewal:${renewal.storeId}:${acceptedProposalId}` ||
          data.acceptedAt !== renewal.acceptedAt ||
          data.acceptedProposalDigest !== createHash('sha256').update(JSON.stringify(proposal)).digest('hex') ||
          proposal.storeId !== renewal.storeId ||
          proposal.customerId !== renewal.customerId ||
          proposal.previousContractId !== renewal.previousContractId ||
          proposal.productId !== renewal.productId ||
          proposal.months !== renewal.months ||
          proposal.totalDueMinor !== renewal.totalPaidMinor ||
          acceptance.customerId !== renewal.customerId ||
          acceptance.storeId !== renewal.storeId ||
          acceptance.acceptedTotalMinor !== renewal.totalPaidMinor ||
          acceptance.acceptedAt !== renewal.acceptedAt) {
        throw new Error('RENEWAL_ACCEPTANCE_CHANGED');
      }
    }
    if (pixAttemptRef) {
      assertVerifiedPrepaidRenewalPixAttempt({
        storeId: renewal.storeId,
        proposalId: acceptedProposalId!,
        acceptedAt: renewal.acceptedAt,
        acceptedTotalMinor: renewal.totalPaidMinor,
        paymentId: renewal.providerPaymentId,
        paymentApprovedAt: verifiedPixPaymentApprovedAt!,
        verifiedPaymentAmountMinor: renewal.totalPaidMinor,
        attempt: pixAttemptDoc?.exists
          ? pixAttemptDoc.data() as PrepaidRenewalPixAttempt : null,
      });
    }
    if (!originalContractDoc.exists ||
        originalContractDoc.get('storeId') !== renewal.storeId ||
        originalContractDoc.get('contractId') !== renewal.previousContractId ||
        originalContractDoc.get('customerId') !== renewal.customerId ||
        originalContractDoc.get('productId') !== renewal.productId ||
        originalContractDoc.get('months') !== renewal.months ||
        typeof originalContractDoc.get('expiresAt') !== 'string' ||
        !Number.isFinite(Date.parse(originalContractDoc.get('expiresAt'))) ||
        !Number.isSafeInteger(originalContractDoc.get('totalPaidMinor')) ||
        originalContractDoc.get('totalPaidMinor') <= 0) {
      throw new Error('RENEWAL_PREDECESSOR_CONTRACT_MISMATCH');
    }
    const linkedSubscriptionId = originalContractDoc.get('subscriptionId');
    const linkedSubscriptionRef = typeof linkedSubscriptionId === 'string' && safeId(linkedSubscriptionId)
      ? adminDb.doc(`stores/${renewal.storeId}/subscriptions/${linkedSubscriptionId}`) : null;
    const linkedSubscriptionDoc = linkedSubscriptionRef ? await tx.get(linkedSubscriptionRef) : null;
    const linkedEntitlement = linkedSubscriptionRef ? assertPrepaidRenewalEntitlementBinding({
      storeId: renewal.storeId,
      previousContractId: renewal.previousContractId,
      customerId: renewal.customerId,
      productId: renewal.productId,
      predecessor: originalContractDoc.data() as Record<string, unknown>,
      subscription: linkedSubscriptionDoc?.exists ? linkedSubscriptionDoc.data() as Record<string, unknown> : null,
    }) : null;
    // Defense in depth: reject overlapping terms or a duration that does not
    // match the fully prepaid renewal. The predecessor is read transactionally.
    // An early renewal extends the predecessor at its expiry. If the old
    // contract has already expired, coverage restarts at verified payment time;
    // never permit overlap or an incorrect prepaid duration.
    if (Date.parse(renewal.startsAt) < Date.parse(originalContractDoc.get('expiresAt')) ||
        addMonthsUtc(renewal.startsAt, renewal.months) !== renewal.expiresAt) {
      throw new Error('INVALID_RENEWAL_CONTRACT_PERIOD');
    }
    const boundPath = paymentDoc.exists ? paymentDoc.get('contractPath') : null;
    if (paymentDoc.exists && (typeof boundPath !== 'string' ||
        !/^stores\/[^/]+\/prepaidSubscriptionContracts\/[^/]+$/.test(boundPath))) {
      throw new Error('RENEWAL_PAYMENT_BINDING_CORRUPT');
    }
    const boundContract = typeof boundPath === 'string' ? adminDb.doc(boundPath) : null;
    const existingPaymentContract = boundContract ? await tx.get(boundContract) : null;
    if (paymentDoc.exists && !existingPaymentContract?.exists) {
      throw new Error('RENEWAL_PAYMENT_BINDING_CORRUPT');
    }
    if (existingPaymentContract && paymentDoc.get('storeId') !== renewal.storeId) {
      throw new Error('RENEWAL_PAYMENT_ALREADY_USED');
    }
    const verdict = resolveRenewalPaymentReplay(
      renewal,
      existingPaymentContract?.data() as RenewalSnapshot | undefined ?? null,
      contractDoc.data() as RenewalSnapshot | undefined ?? null
    );
    if (predecessorDoc.exists && (predecessorDoc.get('contractId') !== renewal.contractId ||
        predecessorDoc.get('providerPaymentId') !== renewal.providerPaymentId)) {
      throw new Error('RENEWAL_PREDECESSOR_ALREADY_RENEWED');
    }
    if (verdict === 'already_recorded') {
      if (!predecessorDoc.exists) throw new Error('RENEWAL_PREDECESSOR_BINDING_MISSING');
      return verdict;
    }
    if (predecessorDoc.exists) throw new Error('RENEWAL_PREDECESSOR_BINDING_CONFLICT');
    const linkedPeriodRef = linkedSubscriptionRef && linkedEntitlement
      ? linkedSubscriptionRef.collection('prepaidPeriods').doc(renewal.contractId) : null;
    const existingLinkedPeriod = linkedPeriodRef ? await tx.get(linkedPeriodRef) : null;
    if (existingLinkedPeriod?.exists) throw new Error('RENEWAL_ENTITLEMENT_PERIOD_ALREADY_EXISTS');
    tx.create(contractRef, linkedEntitlement
      ? { ...renewal, subscriptionId: linkedEntitlement.subscriptionId }
      : renewal);
    if (linkedPeriodRef && linkedEntitlement) {
      tx.create(linkedPeriodRef, {
        contractId: renewal.contractId,
        previousContractId: renewal.previousContractId,
        storeId: renewal.storeId,
        subscriptionId: linkedEntitlement.subscriptionId,
        buyerId: renewal.customerId,
        productId: renewal.productId,
        startsAt: renewal.startsAt,
        expiresAt: renewal.expiresAt,
        providerPaymentId: renewal.providerPaymentId,
        paidAmountMinor: renewal.totalPaidMinor,
        state: 'paid',
      });
    }
    tx.create(predecessorRef, {
      contractId: renewal.contractId,
      providerPaymentId: renewal.providerPaymentId,
    });
    tx.create(paymentRef, {
      contractPath: contractRef.path,
      storeId: renewal.storeId,
      contractId: renewal.contractId,
      provider: 'mercado_pago',
      providerPaymentId: renewal.providerPaymentId,
    });
    return 'created';
  });
};
