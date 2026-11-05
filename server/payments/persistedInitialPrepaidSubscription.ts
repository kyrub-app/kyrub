import { createHash } from 'node:crypto';
import { adminDb } from '../firebaseAdmin.js';
import { parseProductSaleModality } from '../../shared/productSaleModality.js';
import { calculateSubscriptionContractOffer } from '../../shared/subscriptionContractOffers.js';
import { activatePrepaidContractAfterVerifiedPayment } from './prepaidSubscriptionContractLifecycle.js';

const hash = (value: string): string => createHash('sha256').update(value).digest('hex');
const safeId = (value: unknown): value is string =>
  typeof value === 'string' && /^[a-zA-Z0-9_-]{1,128}$/.test(value);
const instant = (value: unknown): value is string => typeof value === 'string' &&
  /^\d{4}-\d{2}-\d{2}T/.test(value) && Number.isFinite(Date.parse(value));

/** Same commercial snapshot used to freeze the server-owned checkout quote. */
export const initialPrepaidCommercialDigest = (data: Record<string, any>): string => hash(JSON.stringify({
  storeId: data.storeId, buyerId: data.buyerId, productId: data.productId,
  ownerUserId: data.ownerUserId, legacyStoreId: data.legacyStoreId,
  productName: data.productName, saleModality: data.saleModality,
  monthlyBasePriceMinor: data.monthlyBasePriceMinor, quote: data.quote,
}));

/**
 * Called only after the authenticated seller-scoped provider verifier. There is
 * no browser-supplied contract/subscription identity or synthetic provider invoice.
 * One transaction materializes the canonical subscription and the first paid
 * period, using the same global payment binding as later prepaid renewals.
 */
export const persistInitialPrepaidSubscription = async (input: {
  storeId: string;
  checkoutId: string;
  authenticatedBuyerId: string;
  payment: { id: string; status: string; amountMinor: number; occurredAt: string; verifiedByProvider: boolean };
  seller: { credentialScopeId: string; externalAccountId: string };
}): Promise<{
  status: 'created' | 'already_recorded'; subscriptionId: string;
  contractId: string; startsAt: string; expiresAt: string;
}> => {
  if (!safeId(input.storeId) || !safeId(input.authenticatedBuyerId) ||
      !/^[a-f0-9]{64}$/.test(input.checkoutId) || !/^\d{1,32}$/.test(input.payment.id) ||
      input.payment.status !== 'approved' || input.payment.verifiedByProvider !== true ||
      !Number.isSafeInteger(input.payment.amountMinor) || input.payment.amountMinor <= 0 ||
      !instant(input.payment.occurredAt) || !input.payment.occurredAt.endsWith('Z') ||
      !safeId(input.seller.credentialScopeId) || !/^\d+$/.test(input.seller.externalAccountId)) {
    throw new Error('INITIAL_PREPAID_PAYMENT_NOT_VERIFIED');
  }
  const root = `stores/${input.storeId}`;
  const subscriptionId = 'prepaid_' + hash(JSON.stringify([input.storeId, input.checkoutId]));
  const contractId = 'initial-' + hash(JSON.stringify([input.storeId, input.checkoutId, input.payment.id]));
  const intentRef = adminDb.doc(`${root}/prepaidSubscriptionCheckouts/${input.checkoutId}`);
  const subscriptionRef = adminDb.doc(`${root}/subscriptions/${subscriptionId}`);
  const contractRef = adminDb.doc(`${root}/prepaidSubscriptionContracts/${contractId}`);
  const periodRef = subscriptionRef.collection('prepaidPeriods').doc(contractId);
  const paymentRef = adminDb.doc(`prepaidRenewalPaymentBindings/${hash('mercado_pago:' + input.payment.id)}`);
  const storeRef = adminDb.doc(root);
  const connectionRef = adminDb.doc(`stores/${input.seller.credentialScopeId}/paymentProviderConnections/mercado_pago`);
  return adminDb.runTransaction(async tx => {
    const [intentDoc, subscriptionDoc, contractDoc, periodDoc, paymentDoc, storeDoc, connectionDoc] = await Promise.all([
      tx.get(intentRef), tx.get(subscriptionRef), tx.get(contractRef), tx.get(periodRef),
      tx.get(paymentRef), tx.get(storeRef), tx.get(connectionRef),
    ]);
    const data = intentDoc.data();
    const store = storeDoc.data();
    const connection = connectionDoc.data();
    if (!data || data.checkoutId !== input.checkoutId || data.storeId !== input.storeId ||
        data.buyerId !== input.authenticatedBuyerId || data.acceptedBy !== input.authenticatedBuyerId ||
        !safeId(data.productId) || !safeId(data.ownerUserId) || !safeId(data.legacyStoreId) ||
        typeof data.productName !== 'string' || !data.productName.trim() ||
        !['bound', 'activated'].includes(data.status) || data.providerPaymentId !== input.payment.id ||
        !instant(data.acceptedAt) || Date.parse(input.payment.occurredAt) < Date.parse(data.acceptedAt) ||
        data.quoteDigest !== initialPrepaidCommercialDigest(data) ||
        data.quoteDigest !== input.checkoutId || data.acceptedQuoteDigest !== data.quoteDigest ||
        data.acceptedTotalMinor !== input.payment.amountMinor ||
        data.quote?.totalMinor !== input.payment.amountMinor || ![3, 6, 12].includes(data.quote?.months) ||
        data.sellerCredentialScopeId !== input.seller.credentialScopeId ||
        data.externalAccountId !== input.seller.externalAccountId ||
        typeof data.requestBody !== 'string' || data.requestDigest !== hash(data.requestBody)) {
      throw new Error('INITIAL_PREPAID_ACCEPTANCE_CHANGED');
    }
    if (!storeDoc.exists || store?.ownerId !== data.ownerUserId ||
        store.ownerId !== input.seller.credentialScopeId ||
        (store.legacyTenantId || store.ownerId) !== data.legacyStoreId ||
        connection?.provider !== 'mercado_pago' || connection.storeId !== input.seller.credentialScopeId ||
        connection.status !== 'connected' || connection.externalAccountId !== input.seller.externalAccountId) {
      throw new Error('INITIAL_PREPAID_SELLER_CHANGED');
    }
    const offer = calculateSubscriptionContractOffer(data.monthlyBasePriceMinor, data.quote.months, data.quote.discountPercent);
    if (offer.totalMinor !== data.quote.totalMinor || offer.monthlyEquivalentMinor !== data.quote.monthlyEquivalentMinor) {
      throw new Error('INITIAL_PREPAID_QUOTE_CHANGED');
    }
    const modality = parseProductSaleModality(data.saleModality);
    if (!modality || modality.mode !== 'subscription' || !modality.subscription ||
        modality.subscription.billingInterval.unit !== 'month' || modality.subscription.billingInterval.count !== 1) {
      throw new Error('INITIAL_PREPAID_TERMS_INVALID');
    }
    let payload: Record<string, any>;
    try { payload = JSON.parse(data.requestBody); } catch { throw new Error('INITIAL_PREPAID_REQUEST_CHANGED'); }
    if (payload.external_reference !== `kyrub:initial-prepaid:${input.storeId}:${input.checkoutId}` ||
        payload.payment_method_id !== 'pix' || payload.transaction_amount !== input.payment.amountMinor / 100 ||
        payload.date_of_expiration !== data.expiresAt ||
        payload.auto_recurring !== undefined || payload.installments !== undefined) {
      throw new Error('INITIAL_PREPAID_REQUEST_CHANGED');
    }
    const slotRef = adminDb.doc(`${root}/subscriptionCheckoutSlots/${hash(`${data.buyerId}:${data.productId}`)}`);
    const slotDoc = await tx.get(slotRef);
    if (!slotDoc.exists || slotDoc.get('checkoutId') !== input.checkoutId ||
        (slotDoc.get('subscriptionId') && slotDoc.get('subscriptionId') !== subscriptionId)) {
      throw new Error('INITIAL_PREPAID_CHECKOUT_IN_PROGRESS');
    }
    const lifecycle = activatePrepaidContractAfterVerifiedPayment({
      state: 'pending_payment', months: data.quote.months, amountMinor: data.quote.totalMinor,
      providerPaymentId: '', paymentConfirmedAt: '', startsAt: '', expiresAt: '',
    }, input.payment);
    const period = {
      contractId, storeId: input.storeId, subscriptionId, buyerId: data.buyerId, productId: data.productId,
      startsAt: lifecycle.startsAt, expiresAt: lifecycle.expiresAt,
      providerPaymentId: input.payment.id, paidAmountMinor: data.quote.totalMinor, state: 'paid',
    };
    if (paymentDoc.exists) {
      if (paymentDoc.get('contractPath') !== contractRef.path || paymentDoc.get('storeId') !== input.storeId ||
          paymentDoc.get('provider') !== 'mercado_pago' || paymentDoc.get('providerPaymentId') !== input.payment.id ||
          paymentDoc.get('subscriptionId') !== subscriptionId || paymentDoc.get('contractId') !== contractId ||
          !subscriptionDoc.exists || subscriptionDoc.get('id') !== subscriptionId ||
          subscriptionDoc.get('buyerId') !== data.buyerId || subscriptionDoc.get('productId') !== data.productId ||
          !contractDoc.exists || contractDoc.get('subscriptionId') !== subscriptionId ||
          contractDoc.get('customerId') !== data.buyerId || contractDoc.get('totalPaidMinor') !== data.quote.totalMinor ||
          contractDoc.get('storeId') !== input.storeId || contractDoc.get('productId') !== data.productId ||
          contractDoc.get('checkoutId') !== input.checkoutId || contractDoc.get('months') !== data.quote.months ||
          contractDoc.get('monthlyBasePriceMinor') !== data.monthlyBasePriceMinor ||
          contractDoc.get('discountPercent') !== data.quote.discountPercent ||
          contractDoc.get('startsAt') !== lifecycle.startsAt || contractDoc.get('expiresAt') !== lifecycle.expiresAt ||
          contractDoc.get('acceptedAt') !== data.acceptedAt || contractDoc.get('providerPaymentId') !== input.payment.id ||
          !periodDoc.exists || Object.keys(period).some(key => periodDoc.get(key) !== period[key])) {
        throw new Error('INITIAL_PREPAID_PAYMENT_ALREADY_USED');
      }
      return { status: 'already_recorded', subscriptionId, contractId,
        startsAt: lifecycle.startsAt, expiresAt: lifecycle.expiresAt };
    }
    if (subscriptionDoc.exists || contractDoc.exists || periodDoc.exists) {
      throw new Error('INITIAL_PREPAID_MATERIALIZATION_CONFLICT');
    }
    const createdAt = new Date().toISOString();
    tx.create(subscriptionRef, {
      schemaVersion: 1, id: subscriptionId, storeId: input.storeId, ownerUserId: data.ownerUserId,
      legacyStoreId: data.legacyStoreId, buyerId: data.buyerId, productId: data.productId,
      buyerEmail: payload.payer?.email || '', productName: data.productName,
      collectionMode: 'prepaid', contractedMonths: data.quote.months,
      amountMinor: data.quote.totalMinor, monthlyBasePriceMinor: data.monthlyBasePriceMinor, currency: 'BRL',
      saleModality: { ...modality, subscription: { ...modality.subscription, autoRenew: false } },
      provider: 'mercado_pago', providerSubscriptionId: '', providerStatus: 'authorized', state: 'active',
      checkoutUrl: '', credentialScopeId: input.seller.credentialScopeId,
      externalAccountId: input.seller.externalAccountId, externalReference: payload.external_reference,
      providerInvoiceId: '', providerPaymentId: input.payment.id,
      providerPaymentStatus: 'approved', providerPaymentStatusDetail: 'accredited',
      providerPaymentOccurredAt: input.payment.occurredAt, paymentConfirmedAt: input.payment.occurredAt,
      createdAt, updatedAt: createdAt, activatedAt: input.payment.occurredAt, cancelledAt: '',
      startsAt: lifecycle.startsAt, expiresAt: lifecycle.expiresAt, initialContractId: contractId,
    });
    tx.create(contractRef, {
      contractId, checkoutId: input.checkoutId, subscriptionId, storeId: input.storeId,
      customerId: data.buyerId, productId: data.productId, months: data.quote.months,
      monthlyBasePriceMinor: data.monthlyBasePriceMinor, discountPercent: data.quote.discountPercent,
      totalPaidMinor: data.quote.totalMinor, acceptedAt: data.acceptedAt,
      startsAt: lifecycle.startsAt, expiresAt: lifecycle.expiresAt, providerPaymentId: input.payment.id,
    });
    tx.create(periodRef, period);
    tx.create(paymentRef, { provider: 'mercado_pago', providerPaymentId: input.payment.id,
      storeId: input.storeId, subscriptionId, contractId, contractPath: contractRef.path });
    tx.update(intentRef, { status: 'activated', subscriptionId, contractId, startsAt: lifecycle.startsAt,
      expiresAt: data.expiresAt, contractExpiresAt: lifecycle.expiresAt, activatedAt: createdAt });
    tx.set(slotRef, { checkoutId: input.checkoutId, subscriptionId, state: 'ready', collectionMode: 'prepaid', updatedAt: createdAt }, { merge: true });
    return { status: 'created', subscriptionId, contractId, startsAt: lifecycle.startsAt, expiresAt: lifecycle.expiresAt };
  });
};
