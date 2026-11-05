import { createHash } from 'node:crypto';
import { assertPrepaidRenewalEntitlementBinding } from './prepaidRenewalEntitlementBinding.js';
import { adminDb } from '../firebaseAdmin.js';
import { authenticateConsultantRequest } from '../ai/consultantAuth.js';
import { resolveCanonicalStoreIdentity } from '../identity/canonicalStoreIdentityService.js';
import { parseProductSaleModality } from '../../shared/productSaleModality.js';
import { parseSubscriptionContractDiscounts } from '../../shared/subscriptionContractOffers.js';
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
  if (!safeId(previous.productId)) throw new Error('INVALID_RENEWAL_PREVIOUS_CONTRACT');
  const productRef = adminDb.doc(`stores/${input.storeId}/products/${previous.productId}`);
  const platformPlanMapping = await adminDb.doc(`kyrub_admin/control_plane/official_plan_products/${previous.productId}`).get();
  const productDoc = await productRef.get();
  if (!productDoc.exists) throw new Error('RENEWAL_PRODUCT_NOT_FOUND');
  if (platformPlanMapping.exists || productDoc.get('platformPlanId') != null) {
    throw new Error('RENEWAL_OFFICIAL_PLAN_PLATFORM_CHECKOUT_REQUIRED');
  }
  const modality = parseProductSaleModality(productDoc.get('saleModality'));
  if (modality?.mode !== 'subscription' ||
      modality.subscription?.billingInterval.unit !== 'month' ||
      modality.subscription.billingInterval.count !== 1) {
    throw new Error('RENEWAL_PRODUCT_NOT_MONTHLY_SUBSCRIPTION');
  }
  if (!safeId(previous.customerId) || !safeId(previous.contractId) ||
      typeof previous.expiresAt !== 'string' ||
      !/^\d{4}-\d{2}-\d{2}T/.test(previous.expiresAt) ||
      !Number.isFinite(Date.parse(previous.expiresAt)) ||
      !Number.isSafeInteger(previous.totalPaidMinor) || previous.totalPaidMinor <= 0) {
    throw new Error('INVALID_RENEWAL_PREVIOUS_CONTRACT');
  }
  if (previous.storeId !== input.storeId ||
      previous.contractId !== input.previousContractId ||
      !safeId(previous.customerId) || !safeId(previous.productId) ||
      ![3, 6, 12].includes(previous.months)) {
    throw new Error('INVALID_RENEWAL_PREVIOUS_CONTRACT');
  }
  // Do not offer a renewal that cannot extend the original entitlement.
  // An unbound legacy contract needs an authorized migration first.
  const subscriptionId = previousDoc.get('subscriptionId');
  if (!safeId(subscriptionId)) throw new Error('RENEWAL_ENTITLEMENT_BINDING_NOT_VERIFIED');
  const subscriptionDoc = await adminDb.doc(
    `stores/${input.storeId}/subscriptions/${subscriptionId}`,
  ).get();
  assertPrepaidRenewalEntitlementBinding({
    storeId: input.storeId, previousContractId: input.previousContractId,
    customerId: previous.customerId, productId: previous.productId,
    predecessor: previousDoc.data() as Record<string, unknown>,
    subscription: subscriptionDoc.exists ? subscriptionDoc.data() as Record<string, unknown> : null,
  });
  const successorRef = adminDb.doc(`stores/${input.storeId}/prepaidRenewalSuccessors/${input.previousContractId}`);
  if (typeof input.discountPercent !== 'number' || !Number.isFinite(input.discountPercent) ||
      input.discountPercent < 0 || input.discountPercent > 100 ||
      Math.abs(Math.round(input.discountPercent * 100) - input.discountPercent * 100) > 1e-8) {
    throw new Error('INVALID_RENEWAL_DISCOUNT');
  }
  // Until a trusted pricing adapter is wired, refuse prices that disagree
  // with the persisted product. Discounts still require seller authorization.
  // Same canonical product fields and cent conversion as the merchant
  // subscription quote: price (BRL) and contractDiscounts. Do not introduce
  // a competing priceMinor / subscriptionContractOffers catalog.
  const storedPrice = productDoc.get('price');
  const rawMinor = typeof storedPrice === 'number' && Number.isFinite(storedPrice)
    ? storedPrice * 100 : NaN;
  const priceMinor = Math.round(rawMinor);
  if (!Number.isSafeInteger(priceMinor) || priceMinor <= 0 ||
      Math.abs(rawMinor - priceMinor) > 1e-7 ||
      priceMinor !== input.currentMonthlyPriceMinor) {
    throw new Error('RENEWAL_PRICE_NOT_VERIFIED');
  }
  const persistedOffers = parseSubscriptionContractDiscounts(productDoc.get('contractDiscounts'));
  if (!persistedOffers?.some(offer =>
    offer.months === previous.months && offer.discountPercent === input.discountPercent
  )) {
    throw new Error('RENEWAL_OFFER_NOT_AUTHORIZED');
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
    const [existing, alreadyRenewed, currentPrevious, currentProduct, currentOfficialMapping] = await Promise.all([
      tx.get(proposalRef), tx.get(successorRef), tx.get(previousRef), tx.get(productRef),
      tx.get(adminDb.doc(`kyrub_admin/control_plane/official_plan_products/${previous.productId}`)),
    ]);
    if (!currentProduct.exists || currentProduct.get('publicationStatus') !== 'published' ||
        JSON.stringify(currentProduct.data()) !== JSON.stringify(productDoc.data())) {
      throw new Error('RENEWAL_PRODUCT_CHANGED');
    }
    if (currentOfficialMapping.exists || currentProduct.get('platformPlanId') != null) {
      throw new Error('RENEWAL_OFFICIAL_PLAN_PLATFORM_CHECKOUT_REQUIRED');
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

/**
 * Authenticated seller-owned proposal entry point. The browser supplies no
 * price, discount or customer ID. This does not initiate a payment.
 * Staff roles can be added only after a separately audited permission check.
 */
export const createOwnerAuthorizedPrepaidRenewalProposal = async (input: {
  authorization: string | null | undefined;
  storeId: string;
  previousContractId: string;
}): Promise<{ proposalId: string; paymentExternalReference: string }> => {
  if (!safeId(input.storeId) || !safeId(input.previousContractId)) {
    throw new Error('INVALID_RENEWAL_PROPOSAL_INPUT');
  }
  const actor = await authenticateConsultantRequest(input.authorization);
  const store = await resolveCanonicalStoreIdentity(input.storeId, { requirePublishedTenant: true });
  if (store.canonicalStoreId !== input.storeId || store.ownerUserId !== actor.uid) {
    throw new Error('RENEWAL_SELLER_NOT_AUTHORIZED');
  }
  const previous = await adminDb.doc(
    `stores/${input.storeId}/prepaidSubscriptionContracts/${input.previousContractId}`
  ).get();
  if (!previous.exists) throw new Error('RENEWAL_PREVIOUS_CONTRACT_NOT_FOUND');
  const productId = previous.get('productId');
  if (!safeId(productId)) throw new Error('INVALID_RENEWAL_PREVIOUS_CONTRACT');
  const product = await adminDb.doc(`stores/${input.storeId}/products/${productId}`).get();
  if (!product.exists || product.get('publicationStatus') !== 'published') {
    throw new Error('RENEWAL_PRODUCT_NOT_PUBLISHED');
  }
  const rawPrice = product.get('price');
  const rawMinor = typeof rawPrice === 'number' && Number.isFinite(rawPrice)
    ? rawPrice * 100 : NaN;
  const monthlyMinor = Math.round(rawMinor);
  if (!Number.isSafeInteger(monthlyMinor) || monthlyMinor <= 0 ||
      Math.abs(rawMinor - monthlyMinor) > 1e-7) {
    throw new Error('RENEWAL_PRICE_NOT_VERIFIED');
  }
  const offers = parseSubscriptionContractDiscounts(product.get('contractDiscounts'));
  const months = previous.get('months');
  const selected = offers?.find(offer => offer.months === months);
  if (!selected) throw new Error('RENEWAL_OFFER_NOT_AUTHORIZED');
  return createPersistedPrepaidRenewalProposal({
    storeId: input.storeId,
    previousContractId: input.previousContractId,
    currentMonthlyPriceMinor: monthlyMinor,
    discountPercent: selected.discountPercent,
  });
};
