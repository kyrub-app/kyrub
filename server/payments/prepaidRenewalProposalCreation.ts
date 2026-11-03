import { createHash } from 'node:crypto';
import { adminDb } from '../firebaseAdmin.js';
import { parseProductSaleModality } from '../../shared/productSaleModality.js';
import {
  createSubscriptionRenewalProposal,
  type AcceptedSubscriptionContract,
} from '../../shared/subscriptionContractRenewal.js';

const safeId = (value: unknown): value is string =>
  typeof value === 'string' && value.length > 0 && value.length <= 180 && !value.includes('/');

/**
 * Internal seller-side operation. Caller MUST authorize the seller and obtain
 * currentMonthlyPriceMinor/discountPercent from the authoritative price and
 * promotion services. This is deliberately not a public endpoint.
 */
export const createPersistedPrepaidRenewalProposal = async (input: {
  storeId: string;
  previousContractId: string;
  currentMonthlyPriceMinor: number;
  discountPercent: number;
}): Promise<{ proposalId: string; paymentExternalReference: string }> => {
  if (!safeId(input.storeId) || !safeId(input.previousContractId) ||
      !Number.isSafeInteger(input.currentMonthlyPriceMinor) ||
      input.currentMonthlyPriceMinor <= 0) {
    throw new Error('INVALID_RENEWAL_PROPOSAL_INPUT');
  }
  const previousRef = adminDb.doc(
    `stores/${input.storeId}/prepaidSubscriptionContracts/${input.previousContractId}`
  );
  const previousDoc = await previousRef.get();
  if (!previousDoc.exists) throw new Error('RENEWAL_PREVIOUS_CONTRACT_NOT_FOUND');
  const previous = previousDoc.data() as AcceptedSubscriptionContract;
  const productRef = adminDb.doc(`stores/${input.storeId}/products/${previous.productId}`);
  const productDoc = await productRef.get();
  if (!productDoc.exists) throw new Error('RENEWAL_PRODUCT_NOT_FOUND');
  const modality = parseProductSaleModality(productDoc.get('saleModality'));
  if (modality?.mode !== 'subscription' ||
      modality.subscription?.billingInterval.unit !== 'month' ||
      modality.subscription.billingInterval.count !== 1) {
    throw new Error('RENEWAL_PRODUCT_NOT_MONTHLY_SUBSCRIPTION');
  }
  if (previous.storeId !== input.storeId ||
      previous.contractId !== input.previousContractId ||
      !safeId(previous.customerId) || !safeId(previous.productId) ||
      ![3, 6, 12].includes(previous.months)) {
    throw new Error('INVALID_RENEWAL_PREVIOUS_CONTRACT');
  }
  const successorRef = adminDb.doc(`stores/${input.storeId}/prepaidRenewalSuccessors/${input.previousContractId}`);
  if (!Number.isSafeInteger(input.discountPercent) || input.discountPercent < 0 || input.discountPercent > 100) {
    throw new Error('INVALID_RENEWAL_DISCOUNT');
  }
  // Until a trusted pricing adapter is wired, refuse prices that disagree
  // with the persisted product. Discounts still require seller authorization.
  const storedPrice = productDoc.get('priceMinor');
  if (!Number.isSafeInteger(storedPrice) || storedPrice <= 0 ||
      storedPrice !== input.currentMonthlyPriceMinor) {
    throw new Error('RENEWAL_PRICE_NOT_VERIFIED');
  }
  const proposal = createSubscriptionRenewalProposal(
    previous, input.currentMonthlyPriceMinor, input.discountPercent
  );
  const proposalId = createHash('sha256').update(
    JSON.stringify([input.storeId, input.previousContractId,
      input.currentMonthlyPriceMinor, input.discountPercent, previous.expiresAt,
      previous.customerId, previous.productId])
  ).digest('hex');
  const paymentExternalReference = `kyrub:prepaid-renewal:${input.storeId}:${proposalId}`;
  if (paymentExternalReference.length > 180) throw new Error('RENEWAL_CHECKOUT_REFERENCE_TOO_LONG');
  const proposalRef = adminDb.doc(
    `stores/${input.storeId}/prepaidRenewalProposals/${proposalId}`
  );
  await adminDb.runTransaction(async tx => {
    const [existing, alreadyRenewed, currentPrevious, currentProduct] = await Promise.all([
      tx.get(proposalRef), tx.get(successorRef), tx.get(previousRef), tx.get(productRef),
    ]);
    if (!currentProduct.exists || JSON.stringify(currentProduct.data()) !== JSON.stringify(productDoc.data())) {
      throw new Error('RENEWAL_PRODUCT_CHANGED');
    }
    if (!currentPrevious.exists || JSON.stringify(currentPrevious.data()) !== JSON.stringify(previousDoc.data())) {
      throw new Error('RENEWAL_PREVIOUS_CONTRACT_CHANGED');
    }
    if (alreadyRenewed.exists) throw new Error('RENEWAL_PREDECESSOR_ALREADY_RENEWED');
    if (existing.exists) {
      const data = existing.data();
      if (data?.status !== 'awaiting_acceptance' ||
          JSON.stringify(data?.proposal) !== JSON.stringify(proposal) ||
          data?.sellerCredentialScopeId !== input.storeId ||
          data?.paymentExternalReference !== paymentExternalReference) {
        throw new Error('RENEWAL_PROPOSAL_CONFLICT');
      }
      return;
    }
    tx.create(proposalRef, {
      status: 'awaiting_acceptance',
      proposal,
      sellerCredentialScopeId: input.storeId,
      paymentExternalReference,
      createdAt: new Date().toISOString(),
    });
  });
  return { proposalId, paymentExternalReference };
};
