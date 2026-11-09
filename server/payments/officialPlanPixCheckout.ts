import { createHash, randomBytes } from 'node:crypto';
import { FieldValue } from 'firebase-admin/firestore';
import { adminDb } from '../firebaseAdmin.js';
import { authenticateConsultantRequest } from '../ai/consultantAuth.js';
import { getOfficialStoreIdentity } from '../admin/officialStoreService.js';
import { resolvePersistedProductCheckoutRoute } from '../admin/officialPlanProductLookup.js';
import { loadPublicActivePlanCatalog } from '../admin/publicPlanCatalogService.js';
import { writePlanMirrors } from '../admin/paidPlanSubscriptionService.js';
import { resolveSubscriptionContractQuote } from './subscriptionContractQuote.js';
import { addMonthsUtc } from './prepaidSubscriptionContractLifecycle.js';
import { activatePaidOfficialPlan, officialPixStatusAfterProviderBind, resolveOfficialPlanBuyerStore } from './officialPlanActivationSchedule.js';
import { prepareStoreEconomicLedgerConfirmedCapture, applyStoreEconomicLedgerPaymentPlan } from './storeEconomicLedgerService.js';
import { buildStorePointPurchaseEntry } from '../../shared/storePoints.js';
import { reconcilePaidSubscriberIntoCrm } from './storeSubscriberRegistryService.js';
import { reconcileStoreSubscriptionBenefitCycle } from './storeSubscriptionBenefitService.js';
import { persistVerifiedKyrubXp } from '../gamification/xpLedgerRepository.js';
import { officialPlanPixAccount, officialPlanPixRequest, verifyOfficialPlanPixSignature } from './officialPlanPixProvider.js';
import type { ContractTermMonths } from '../../shared/subscriptionContractOffers.js';
import type { CanonicalPayment } from '../../src/utils/canonicalPayment.js';
import { parseOfficialPlanRewards } from '../../shared/officialPlanRewards.js';

const ROOT = 'kyrub_admin/control_plane';
const hash = (value: string) => createHash('sha256').update(value).digest('hex');
const canonicalize = (value: any): any => Array.isArray(value) ? value.map(canonicalize)
  : value && typeof value === 'object' ? Object.fromEntries(Object.keys(value).sort().map(key => [key, canonicalize(value[key])])) : value;
const digest = (value: unknown) => hash(JSON.stringify(canonicalize(value)));
const valid = (value: unknown): value is string => typeof value === 'string' && /^[a-zA-Z0-9_-]{1,128}$/.test(value);
const checkId = (value: string) => { if (!/^[a-f0-9]{64}$/.test(value)) throw Error('OFFICIAL_PIX_INVALID_CHECKOUT'); };
const checkoutRef = (id: string) => adminDb.doc(`${ROOT}/plan_pix_checkouts/${id}`);
const slotRef = (uid: string) => adminDb.doc(`${ROOT}/store_subscriptions/${uid}`);
const entitlementRef = (uid: string) => adminDb.doc(`${ROOT}/store_entitlements/${uid}`);
const pilotRef = () => adminDb.doc(`${ROOT}/official_plan_pix_pilot/one_shot`);
const gate = () => { if (process.env.KYRUB_OFFICIAL_PLAN_PIX_CHECKOUT_ENABLED !== 'true') throw Error('OFFICIAL_PIX_DISABLED'); };
// Fail closed whenever live creation is enabled. Pilot mode restricts issuance
// to one authenticated user and one canonical Pro/month offer.
const pilotUid = () => process.env.KYRUB_OFFICIAL_PLAN_PIX_PILOT_BUYER_UID?.trim() || '';
const allowPilotOffer = (d: any, uid: string) => {
  gate();
  if (process.env.KYRUB_OFFICIAL_PLAN_PIX_PILOT_MODE !== 'true') throw Error('OFFICIAL_PIX_PILOT_MODE_REQUIRED');
  if (!valid(pilotUid()) || uid !== pilotUid()) throw Error('OFFICIAL_PIX_PILOT_FORBIDDEN');
  if (d.offer.plan !== 'pro' || d.offer.quote.months !== 1 ||
      d.offer.quote.totalMinor !== 19700) {
    throw Error('OFFICIAL_PIX_PILOT_OFFER_FORBIDDEN');
  }
};
const now = () => new Date().toISOString();
const reference = (id: string) => `kyrub:official-plan-pix:${id}`;
const liveEntitlement = (value: any) => {
  if (value?.status !== 'active') return false;
  const expiry = Date.parse(value.benefitEndsAt?.toDate?.().toISOString() || value.benefitEndsAt);
  return !Number.isFinite(expiry) || expiry > Date.now();
};
const blockedSlot = (value: any) => value?.checkoutReservationStatus === 'pending' ||
  // A paid contract awaiting store activation has no expiry date yet.
  // It must still block a second checkout for the same buyer.
  value?.checkoutReservationStatus === 'paid_pending_activation' ||
  value?.state === 'paid_pending_activation' ||
  (value?.providerSubscriptionId && value.providerStatus !== 'cancelled') ||
  (value?.collectionMode === 'prepaid' && Date.parse(value.expiresAt) > Date.now());

async function offer(storeId: string, productId: string, months: ContractTermMonths) {
  const route = await resolvePersistedProductCheckoutRoute({ sellerStoreReference: storeId, productId, allowOfficialContractOffers: true });
  if (route.kind !== 'platform-plan') throw Error('OFFICIAL_PIX_PRODUCT_REQUIRED');
  const official = await getOfficialStoreIdentity();
  if (!official || official.canonicalStoreId !== storeId) throw Error('OFFICIAL_PIX_STORE_CHANGED');
  const [product, mapping, catalog] = await Promise.all([
    adminDb.doc(`stores/${storeId}/products/${productId}`).get(),
    adminDb.doc(`${ROOT}/official_plan_products/${productId}`).get(),
    loadPublicActivePlanCatalog(),
  ]);
  const p = product.data()!;
  const plan = catalog.plans.find(entry => entry.planId === route.plan);
  if (!plan) throw Error('OFFICIAL_PIX_PLAN_NOT_ACTIVE');
  const quote = resolveSubscriptionContractQuote({ persistedSaleModality: p.saleModality,
    authoritativeMonthlyPriceMinor: Math.round(p.price * 100), persistedOffers: p.contractDiscounts,
    selectedMonths: months, paymentTerms: { collectionMode: 'prepaid', installments: 1 } });
  if (quote.totalMinor <= 0 || typeof p.name !== 'string' || !p.name.trim() || p.name.length > 240) throw Error('OFFICIAL_PIX_INVALID_OFFER');
  const rewards = parseOfficialPlanRewards(mapping.get('rewards'));
  const points = p.storePointsPerUnit ?? 0;
  if (!Number.isSafeInteger(points) || points < 0) throw Error('OFFICIAL_PIX_INVALID_POINTS');
  return { storeId, productId, plan: route.plan, planVersion: plan.version,
    productName: p.name, priceMinor: Math.round(p.price * 100), saleModality: p.saleModality,
    ownerUserId: official.ownerUserId, legacyStoreId: official.legacyStoreId, quote, rewards, points };
}

export async function quoteOfficialPlanPix(input: { authorization: string; storeId: string; productId: string; selectedMonths: ContractTermMonths }) {
  const buyer = await authenticateConsultantRequest(input.authorization);
  if (!valid(input.storeId) || !valid(input.productId) || ![1, 3, 6, 12].includes(input.selectedMonths)) throw Error('OFFICIAL_PIX_INVALID_REQUEST');
  // Reopen an unresolved attempt with its original accepted terms, even after the catalog changes.
  const slot = await slotRef(buyer.uid).get();
  if (slot.get('officialPixCheckoutId') && blockedSlot(slot.data())) {
    const d = (await checkoutRef(slot.get('officialPixCheckoutId')).get()).data();
    if (d?.buyerId !== buyer.uid || d?.offer.storeId !== input.storeId || d?.offer.productId !== input.productId) throw Error('OFFICIAL_PIX_EXISTING_CHECKOUT');
    return { checkoutId: slot.get('officialPixCheckoutId'), quote: d.offer.quote, status: d.status };
  }
  if (blockedSlot(slot.data())) throw Error('OFFICIAL_PIX_EXISTING_SUBSCRIPTION');
  const [snapshot, owned, legacy, entitlement] = await Promise.all([
    offer(input.storeId, input.productId, input.selectedMonths),
    adminDb.collection('stores').where('ownerId', '==', buyer.uid).get(),
    adminDb.doc(`users/${buyer.uid}/stores/${buyer.uid}`).get(), entitlementRef(buyer.uid).get(),
  ]);
  // The buyer may purchase a plan before creating a store. A legacy Free
  // profile alone is not proof that a canonical store has been activated.
  // Multiple canonical stores are ambiguous and must never be guessed.
  const buyerStore = resolveOfficialPlanBuyerStore({
    canonicalStoreIds: owned.docs.map(document => document.id),
    hasLegacyStore: legacy.exists,
  });
  if (liveEntitlement(entitlement.data())) throw Error('OFFICIAL_PIX_ACTIVE_ENTITLEMENT');
  const checkoutId = randomBytes(32).toString('hex');
  await checkoutRef(checkoutId).create({ checkoutId, buyerId: buyer.uid, buyerEmail: buyer.email || '',
    ...buyerStore,
    offer: snapshot, offerDigest: digest(snapshot), status: 'quoted', quotedAt: now() });
  return { checkoutId, quote: snapshot.quote, status: 'quoted' };
}

async function load(authorization: string, checkoutId: string) {
  checkId(checkoutId);
  const buyer = await authenticateConsultantRequest(authorization);
  const d = (await checkoutRef(checkoutId).get()).data();
  if (!d || d.buyerId !== buyer.uid || digest(d.offer) !== d.offerDigest) throw Error('OFFICIAL_PIX_FORBIDDEN');
  return { buyer, d };
}

export async function acceptOfficialPlanPix(input: { authorization: string; checkoutId: string; acceptedTotalMinor: number }) {
  const { buyer } = await load(input.authorization, input.checkoutId);
  return adminDb.runTransaction(async tx => {
    const r = checkoutRef(input.checkoutId), doc = await tx.get(r), d = doc.data()!;
    if (d.buyerId !== buyer.uid || d.offer.quote.totalMinor !== input.acceptedTotalMinor || digest(d.offer) !== d.offerDigest) throw Error('OFFICIAL_PIX_ACCEPTANCE_REQUIRED');
    if (d.acceptedAt) return { status: 'already_accepted' };
    if (d.status !== 'quoted') throw Error('OFFICIAL_PIX_ACCEPTANCE_REQUIRED');
    const acceptedAt = now();
    tx.update(r, { acceptedAt, acceptedBy: buyer.uid, acceptedOfferDigest: d.offerDigest, status: 'accepted', expiresAt: new Date(Date.parse(acceptedAt) + 30 * 60000).toISOString() });
    return { status: 'accepted' };
  });
}

function validatePayment(payment: any, d: any) {
  const cents = payment?.transaction_amount * 100;
  if (!/^\d{1,32}$/.test(String(payment?.id)) || payment.currency_id !== 'BRL' || payment.payment_method_id !== 'pix' ||
    String(payment.collector_id) !== d.collectorId || payment.external_reference !== reference(d.checkoutId) ||
    !Number.isSafeInteger(Math.round(cents)) || Math.abs(cents - Math.round(cents)) > 1e-6 || Math.round(cents) !== d.offer.quote.totalMinor ||
    Number(payment.transaction_amount_refunded ?? 0) !== 0 ||
    (process.env.VERCEL_ENV === 'production' && payment.live_mode !== true)) throw Error('OFFICIAL_PIX_PAYMENT_MISMATCH');
}

async function bind(d: any, paymentId: string) {
  await adminDb.runTransaction(async tx => {
    const r = checkoutRef(d.checkoutId), latest = await tx.get(r);
    if (latest.get('offerDigest') !== d.offerDigest || latest.get('requestDigest') !== d.requestDigest ||
      latest.get('collectorId') !== d.collectorId || (latest.get('providerPaymentId') && latest.get('providerPaymentId') !== paymentId)) throw Error('OFFICIAL_PIX_BINDING_CONFLICT');
    tx.update(r, { providerPaymentId: paymentId, status: officialPixStatusAfterProviderBind(latest.get('status')) });
  });
}

export async function checkoutOfficialPlanPix(input: { authorization: string; checkoutId: string }) {
  const { buyer, d } = await load(input.authorization, input.checkoutId);
  if (d.status !== 'accepted') return reconcileOfficialPlanPix(input);
  allowPilotOffer(d, buyer.uid);
  // Do not issue real Pix for pre-activation purchases until the payment
  // materializer can atomically persist a pending contract without a store.
  if (d.buyerStoreProvisioningRequired || !d.buyerStoreId) {
    throw Error('OFFICIAL_PIX_PENDING_ACTIVATION_NOT_READY');
  }
  if (!buyer.email || buyer.emailVerified === false || !d.acceptedAt || d.acceptedBy !== buyer.uid ||
    d.acceptedOfferDigest !== d.offerDigest || Date.parse(d.expiresAt) <= Date.now()) throw Error('OFFICIAL_PIX_ACCEPTANCE_REQUIRED');
  const fresh = await offer(d.offer.storeId, d.offer.productId, d.offer.quote.months);
  if (digest(fresh) !== d.offerDigest) throw Error('OFFICIAL_PIX_OFFER_CHANGED');
  const collectorId = await officialPlanPixAccount();
  const url = new URL(process.env.KYRUB_PLAN_BILLING_WEBHOOK_URL || 'https://www.kyrub.com/api/plan-control');
  if (url.protocol !== 'https:') throw Error('OFFICIAL_PIX_WEBHOOK_URL_INVALID');
  url.pathname = '/api/plan-control'; url.search = ''; url.hash = '';
  url.searchParams.set('op', 'official.prepaid.webhook'); url.searchParams.set('checkoutId', d.checkoutId);
  const body = JSON.stringify({ transaction_amount: d.offer.quote.totalMinor / 100, payment_method_id: 'pix',
    payer: { email: buyer.email }, description: d.offer.productName, notification_url: url.toString(),
    date_of_expiration: d.expiresAt, external_reference: reference(d.checkoutId) });
  await adminDb.runTransaction(async tx => {
    const r = checkoutRef(d.checkoutId), slot = slotRef(buyer.uid);
    const [current, lock, entitlement, product, mapping, buyerStore, seller, designation, pilot] = await Promise.all([
      tx.get(r), tx.get(slot), tx.get(entitlementRef(buyer.uid)),
      tx.get(adminDb.doc(`stores/${d.offer.storeId}/products/${d.offer.productId}`)),
      tx.get(adminDb.doc(`${ROOT}/official_plan_products/${d.offer.productId}`)), tx.get(adminDb.doc(`stores/${d.buyerStoreId}`)),
      tx.get(adminDb.doc(`stores/${d.offer.storeId}`)), tx.get(adminDb.doc('kyrub_admin/official_store')),
      tx.get(pilotRef()),
    ]);
    if (current.get('status') !== 'accepted' || blockedSlot(lock.data()) || liveEntitlement(entitlement.data())) throw Error('OFFICIAL_PIX_CHECKOUT_IN_PROGRESS');
    allowPilotOffer(d, buyer.uid);
    if (pilot.exists) throw Error('OFFICIAL_PIX_PILOT_ALREADY_USED');
    if (buyerStore.get('ownerId') !== buyer.uid || seller.get('ownerId') !== d.offer.ownerUserId ||
      (seller.get('legacyTenantId') || seller.get('ownerId')) !== d.offer.legacyStoreId || designation.get('canonicalStoreId') !== d.offer.storeId ||
      product.get('publicationStatus') !== 'published' ||
      mapping.get('status') !== 'active' || mapping.get('planId') !== d.offer.plan || mapping.get('canonicalStoreId') !== d.offer.storeId ||
      Math.round(product.get('price') * 100) !== d.offer.priceMinor || product.get('name') !== d.offer.productName ||
      digest(parseOfficialPlanRewards(mapping.get('rewards'))) !== digest(d.offer.rewards) ||
      (product.get('storePointsPerUnit') ?? 0) !== d.offer.points || digest(product.get('saleModality')) !== digest(d.offer.saleModality) ||
      digest(resolveSubscriptionContractQuote({ persistedSaleModality: product.get('saleModality'), authoritativeMonthlyPriceMinor: d.offer.priceMinor,
        persistedOffers: product.get('contractDiscounts'), selectedMonths: d.offer.quote.months, paymentTerms: { collectionMode: 'prepaid', installments: 1 } })) !== digest(d.offer.quote)) throw Error('OFFICIAL_PIX_OFFER_CHANGED');
    tx.create(pilotRef(), { checkoutId: d.checkoutId, buyerId: buyer.uid, consumedAt: now() });
    tx.set(slot, { checkoutReservationStatus: 'pending', officialPixCheckoutId: d.checkoutId, collectionMode: 'prepaid', updatedAt: now() }, { merge: true });
    tx.update(r, { status: 'in_flight', collectorId, requestBody: body, requestDigest: hash(body), buyerEmail: buyer.email });
  });
  try {
    if (await officialPlanPixAccount() !== collectorId) throw Error('OFFICIAL_PIX_ACCOUNT_CHANGED');
    allowPilotOffer(d, buyer.uid);
    const payment = await officialPlanPixRequest('/v1/payments', { method: 'POST', body,
      headers: { 'X-Idempotency-Key': `official-plan-${d.checkoutId}` } });
    const bound = { ...d, collectorId, requestDigest: hash(body) };
    validatePayment(payment, bound);
    await bind(bound, String(payment.id));
  } catch {
    await adminDb.runTransaction(async tx => {
      const r = checkoutRef(d.checkoutId), current = await tx.get(r);
      if (current.get('status') === 'in_flight') tx.update(r, { status: 'outcome_unknown' });
    });
    console.warn('[official-plan-pix]', { checkoutId: d.checkoutId, stage: 'outcome_unknown' });
    return { state: 'recovery_required' };
  }
  return reconcileOfficialPlanPix(input);
}

/**
 * Persist a verified Pix payment without activating a store or starting a
 * subscription term. This branch is deliberately unreachable from new Pix
 * issuance until the full preactivation flow has passed integration tests.
 */
async function materializePendingStoreActivation(d: any, payment: any) {
  const approvedAt = typeof payment.date_approved === 'string' ? Date.parse(payment.date_approved) : NaN;
  if (payment.status_detail !== 'accredited' || !Number.isFinite(approvedAt) ||
      !Number.isFinite(Date.parse(d.acceptedAt)) || approvedAt < Date.parse(d.acceptedAt)) {
    throw Error('OFFICIAL_PIX_PAYMENT_NOT_CONFIRMED');
  }
  const paidAt = new Date(approvedAt).toISOString();
  const uid = d.buyerId, storeId = d.offer.storeId;
  const id = `official_${d.checkoutId}`, contractId = `official-${d.checkoutId}`;
  const root = `stores/${storeId}`;
  const contractRef = adminDb.doc(`${root}/prepaidSubscriptionContracts/${contractId}`);
  const subscriptionRef = adminDb.doc(`${root}/subscriptions/${id}`);
  const bindingRef = adminDb.doc(`prepaidRenewalPaymentBindings/${hash('mercado_pago:' + payment.id)}`);
  const paymentId = `official_pix_${payment.id}`;
  const canonical: CanonicalPayment = {
    id: paymentId, storeId, orderId: contractId, buyerId: uid,
    paymentIntentId: d.checkoutId, amount: d.offer.quote.totalMinor / 100,
    currency: 'BRL', method: 'pix', context: 'pos', status: 'paid',
    provider: 'mercado-pago', providerPaymentId: String(payment.id),
    idempotencyKey: d.checkoutId, createdAt: paidAt, updatedAt: paidAt,
    paidAt, refundedAt: '',
  };
  await adminDb.runTransaction(async tx => {
    const checkout = checkoutRef(d.checkoutId), slot = slotRef(uid);
    const [current, existingBinding, lock, existingContract, existingSubscription, seller] = await Promise.all([
      tx.get(checkout), tx.get(bindingRef), tx.get(slot),
      tx.get(contractRef), tx.get(subscriptionRef), tx.get(adminDb.doc(`stores/${storeId}`)),
    ]);
    if (current.get('providerPaymentId') !== String(payment.id) ||
        current.get('offerDigest') !== digest(d.offer) ||
        current.get('acceptedOfferDigest') !== current.get('offerDigest') ||
        current.get('acceptedBy') !== uid ||
        current.get('requestDigest') !== hash(current.get('requestBody')) ||
        current.get('collectorId') !== d.collectorId ||
        seller.get('ownerId') !== d.offer.ownerUserId) {
      throw Error('OFFICIAL_PIX_ACCEPTANCE_CHANGED');
    }
    if (existingBinding.exists) {
      const currentStatus = current.get('status');
      const contractState = existingContract.get('state');
      if (existingBinding.get('contractPath') !== contractRef.path ||
          existingBinding.get('providerPaymentId') !== String(payment.id) ||
          existingSubscription.get('buyerId') !== uid ||
          !(
            (currentStatus === 'paid_pending_activation' && contractState === 'paid_pending_activation') ||
            (currentStatus === 'activated' && contractState === 'active')
          )) {
        throw Error('OFFICIAL_PIX_PAYMENT_ALREADY_USED');
      }
      // Once the store activates, provider retries must not reset the
      // contract dates or downgrade the subscription.
      return;
    }
    if (lock.get('officialPixCheckoutId') !== d.checkoutId ||
        !d.buyerStoreProvisioningRequired || d.buyerStoreId !== null ||
        existingContract.exists || existingSubscription.exists) {
      throw Error('OFFICIAL_PIX_ACTIVATION_CONFLICT');
    }
    const finance = await prepareStoreEconomicLedgerConfirmedCapture({
      transaction: tx, payment: canonical, paymentIntentId: d.checkoutId,
    });
    tx.create(bindingRef, {
      provider: 'mercado_pago', providerPaymentId: String(payment.id),
      storeId, subscriptionId: id, contractId, contractPath: contractRef.path,
    });
    tx.create(contractRef, {
      contractId, checkoutId: d.checkoutId, subscriptionId: id, storeId,
      customerId: uid, productId: d.offer.productId, months: d.offer.quote.months,
      totalPaidMinor: d.offer.quote.totalMinor, monthlyBasePriceMinor: d.offer.priceMinor,
      discountPercent: d.offer.quote.discountPercent, acceptedAt: d.acceptedAt,
      paidAt, state: 'paid_pending_activation', startsAt: null, expiresAt: null,
      providerPaymentId: String(payment.id),
    });
    tx.create(subscriptionRef, {
      schemaVersion: 1, id, storeId, buyerId: uid, buyerEmail: d.buyerEmail,
      ownerUserId: d.offer.ownerUserId, legacyStoreId: d.offer.legacyStoreId,
      productId: d.offer.productId, productName: d.offer.productName,
      collectionMode: 'prepaid', contractedMonths: d.offer.quote.months,
      amountMinor: d.offer.quote.totalMinor, monthlyBasePriceMinor: d.offer.priceMinor,
      currency: 'BRL', saleModality: d.offer.saleModality,
      provider: 'mercado_pago', providerSubscriptionId: '',
      providerStatus: 'authorized', state: 'paid_pending_activation',
      credentialScopeId: 'kyrub_platform_billing', externalAccountId: d.collectorId,
      externalReference: reference(d.checkoutId), providerPaymentId: String(payment.id),
      providerPaymentStatus: 'approved', providerPaymentStatusDetail: 'accredited',
      providerPaymentOccurredAt: paidAt, paymentConfirmedAt: paidAt,
      createdAt: paidAt, updatedAt: paidAt, activatedAt: null,
      startsAt: null, expiresAt: null, initialContractId: contractId,
      billingAuthority: 'platform',
    });
    tx.create(subscriptionRef.collection('prepaidPeriods').doc(contractId), {
      contractId, storeId, subscriptionId: id, buyerId: uid,
      productId: d.offer.productId, startsAt: null, expiresAt: null,
      providerPaymentId: String(payment.id), paidAmountMinor: d.offer.quote.totalMinor,
      state: 'paid_pending_activation',
    });
    tx.create(adminDb.doc(`${root}/payments/${paymentId}`), canonical);
    applyStoreEconomicLedgerPaymentPlan(tx, finance);
    tx.set(slot, {
      checkoutReservationStatus: 'paid_pending_activation', collectionMode: 'prepaid',
      officialPixCheckoutId: d.checkoutId, providerPaymentId: String(payment.id),
      providerStatus: 'authorized', updatedAt: paidAt,
    }, { merge: true });
    tx.update(checkout, {
      status: 'paid_pending_activation', subscriptionId: id, contractId,
      startsAt: null, contractExpiresAt: null, effectsStatus: 'pending',
    });
  });
  // Read after the transaction: a concurrent store activation may have
  // advanced this same contract while the provider callback was running.
  const settled = await checkoutRef(d.checkoutId).get();
  if (settled.get('status') === 'activated') {
    return { state: 'activated', subscriptionId: id, contractId,
      startsAt: settled.get('startsAt'), expiresAt: settled.get('contractExpiresAt') };
  }
  return { state: 'paid_pending_activation', subscriptionId: id, contractId,
    startsAt: null, expiresAt: null };
}

/**
 * Called by the authoritative store-activation backend after canonical store
 * creation has committed. Never call this from the Renda navigation button.
 * The buyer is determined by the canonical store owner, not client input.
 */
export async function activatePendingOfficialPlanForStore(input: {
  buyerUid: string; canonicalStoreId: string; activatedAt: string;
}) {
  if (!valid(input.buyerUid) || !valid(input.canonicalStoreId) ||
      !Number.isFinite(Date.parse(input.activatedAt))) {
    throw Error('OFFICIAL_PLAN_INVALID_ACTIVATION');
  }
  const slot = slotRef(input.buyerUid);
  const currentSlot = await slot.get();
  if (currentSlot.get('checkoutReservationStatus') !== 'paid_pending_activation') {
    return { state: 'no_pending_contract' };
  }
  const checkoutId = currentSlot.get('officialPixCheckoutId');
  if (typeof checkoutId !== 'string') throw Error('OFFICIAL_PLAN_PENDING_CHECKOUT_MISSING');
  checkId(checkoutId);
  const checkout = checkoutRef(checkoutId);
  const outcome = await adminDb.runTransaction(async tx => {
    const store = adminDb.doc(`stores/${input.canonicalStoreId}`);
    const privateStore = adminDb.doc(`users/${input.buyerUid}/stores/${input.buyerUid}`);
    const [storeDoc, privateDoc, slotDoc, checkoutDoc, entitlementDoc] = await Promise.all([
      tx.get(store), tx.get(privateStore), tx.get(slot), tx.get(checkout),
      tx.get(entitlementRef(input.buyerUid)),
    ]);
    if (storeDoc.get('ownerId') !== input.buyerUid || !privateDoc.exists) {
      throw Error('OFFICIAL_PLAN_STORE_IDENTITY_CONFLICT');
    }
    const d = checkoutDoc.data();
    if (!d || d.buyerId !== input.buyerUid ||
        slotDoc.get('officialPixCheckoutId') !== checkoutId ||
        d.status !== 'paid_pending_activation' ||
        !d.buyerStoreProvisioningRequired || d.buyerStoreId !== null ||
        liveEntitlement(entitlementDoc.data())) {
      throw Error('OFFICIAL_PLAN_PENDING_CONTRACT_CONFLICT');
    }
    const contractId = d.contractId, subscriptionId = d.subscriptionId;
    if (!valid(contractId) || !valid(subscriptionId)) {
      throw Error('OFFICIAL_PLAN_PENDING_CONTRACT_MISSING');
    }
    const root = `stores/${d.offer.storeId}`;
    const contract = adminDb.doc(`${root}/prepaidSubscriptionContracts/${contractId}`);
    const subscription = adminDb.doc(`${root}/subscriptions/${subscriptionId}`);
    const period = subscription.collection('prepaidPeriods').doc(contractId);
    const [contractDoc, subscriptionDoc, periodDoc] = await Promise.all([
      tx.get(contract), tx.get(subscription), tx.get(period),
    ]);
    if (contractDoc.get('state') !== 'paid_pending_activation' ||
        subscriptionDoc.get('state') !== 'paid_pending_activation' ||
        periodDoc.get('state') !== 'paid_pending_activation' ||
        contractDoc.get('customerId') !== input.buyerUid ||
        subscriptionDoc.get('buyerId') !== input.buyerUid) {
      throw Error('OFFICIAL_PLAN_PENDING_CONTRACT_CONFLICT');
    }
    const schedule = activatePaidOfficialPlan({
      schedule: {
        state: 'paid_pending_activation',
        paidAt: contractDoc.get('paidAt'),
        startsAt: null, expiresAt: null,
      },
      activatedAt: input.activatedAt,
      months: d.offer.quote.months,
    });
    const startsAt = schedule.startsAt!, expiresAt = schedule.expiresAt!;
    tx.update(contract, { state: 'active', startsAt, expiresAt,
      buyerStoreId: input.canonicalStoreId, activatedAt: startsAt });
    tx.update(subscription, { state: 'active', startsAt, expiresAt,
      activatedAt: startsAt, buyerStoreId: input.canonicalStoreId, updatedAt: startsAt });
    tx.update(period, { state: 'paid', startsAt, expiresAt });
    writePlanMirrors(tx, input.buyerUid, input.canonicalStoreId,
      d.offer.plan, FieldValue.serverTimestamp());
    tx.set(entitlementRef(input.buyerUid), {
      schemaVersion: 2, storeId: input.buyerUid, ownerId: input.buyerUid,
      plan: d.offer.plan, planVersion: d.offer.planVersion,
      source: 'subscription', status: 'active',
      benefitStartsAt: startsAt, benefitEndsAt: expiresAt,
      provider: 'mercado-pago', providerPaymentId: d.providerPaymentId,
      officialPixCheckoutId: checkoutId, updatedAt: FieldValue.serverTimestamp(),
    });
    tx.set(slot, { checkoutReservationStatus: 'complete', expiresAt,
      updatedAt: startsAt }, { merge: true });
    tx.update(checkout, { status: 'activated', startsAt,
      contractExpiresAt: expiresAt, effectsStatus: 'pending' });
    return { state: 'activated' as const, subscriptionId, contractId,
      startsAt, expiresAt, storeId: d.offer.storeId };
  });
  if (outcome.state === 'activated') {
    await reconcilePaidSubscriberIntoCrm(outcome.storeId, input.buyerUid);
    await reconcileStoreSubscriptionBenefitCycle(outcome.storeId, outcome.subscriptionId);
    await checkout.update({ effectsStatus: 'complete' });
  }
  return outcome;
}

async function materialize(d: any, payment: any) {
  const approvedAt = typeof payment.date_approved === 'string' ? Date.parse(payment.date_approved) : NaN;
  if (payment.status_detail !== 'accredited' || !Number.isFinite(approvedAt) || !Number.isFinite(Date.parse(d.acceptedAt)) || approvedAt < Date.parse(d.acceptedAt)) throw Error('OFFICIAL_PIX_PAYMENT_NOT_CONFIRMED');
  const startsAt = new Date(approvedAt).toISOString(), expiresAt = addMonthsUtc(startsAt, d.offer.quote.months);
  const storeId = d.offer.storeId, uid = d.buyerId, id = `official_${d.checkoutId}`, contractId = `official-${d.checkoutId}`;
  const root = `stores/${storeId}`, subscriptionRef = adminDb.doc(`${root}/subscriptions/${id}`);
  const contractRef = adminDb.doc(`${root}/prepaidSubscriptionContracts/${contractId}`);
  const bindingRef = adminDb.doc(`prepaidRenewalPaymentBindings/${hash('mercado_pago:' + payment.id)}`);
  const paymentId = `official_pix_${payment.id}`;
  const canonical: CanonicalPayment = { id: paymentId, storeId, orderId: contractId, buyerId: uid,
    paymentIntentId: d.checkoutId, amount: d.offer.quote.totalMinor / 100, currency: 'BRL', method: 'pix', context: 'pos',
    status: 'paid', provider: 'mercado-pago', providerPaymentId: String(payment.id), idempotencyKey: d.checkoutId,
    createdAt: startsAt, updatedAt: startsAt, paidAt: startsAt, refundedAt: '' };
  const pointEntry = buildStorePointPurchaseEntry({ storeId, customerId: uid, orderId: contractId, paymentId,
    paymentIntentId: d.checkoutId, occurredAt: startsAt, items: [{ productId: d.offer.productId, name: d.offer.productName, quantity: 1, storePointsPerUnit: d.offer.points }] });
  await adminDb.runTransaction(async tx => {
    const r = checkoutRef(d.checkoutId);
    const [current, binding, slot, buyerStore, entitlement, existingContract, existingSubscription, seller] = await Promise.all([
      tx.get(r), tx.get(bindingRef), tx.get(slotRef(uid)), tx.get(adminDb.doc(`stores/${d.buyerStoreId}`)), tx.get(entitlementRef(uid)),
      tx.get(contractRef), tx.get(subscriptionRef), tx.get(adminDb.doc(`stores/${storeId}`)),
    ]);
    if (current.get('providerPaymentId') !== String(payment.id) || current.get('offerDigest') !== digest(d.offer) ||
      current.get('acceptedOfferDigest') !== current.get('offerDigest') || current.get('acceptedBy') !== uid ||
      current.get('requestDigest') !== hash(current.get('requestBody')) || current.get('collectorId') !== d.collectorId) throw Error('OFFICIAL_PIX_ACCEPTANCE_CHANGED');
    if (binding.exists) {
      if (binding.get('contractPath') !== contractRef.path || binding.get('providerPaymentId') !== String(payment.id) ||
        current.get('status') !== 'activated' || existingContract.get('startsAt') !== startsAt || existingContract.get('expiresAt') !== expiresAt ||
        existingContract.get('totalPaidMinor') !== d.offer.quote.totalMinor || existingSubscription.get('buyerId') !== uid) throw Error('OFFICIAL_PIX_PAYMENT_ALREADY_USED');
      return;
    }
    if (slot.get('officialPixCheckoutId') !== d.checkoutId || buyerStore.get('ownerId') !== uid || seller.get('ownerId') !== d.offer.ownerUserId ||
      liveEntitlement(entitlement.data())) throw Error('OFFICIAL_PIX_ACTIVATION_CONFLICT');
    const finance = await prepareStoreEconomicLedgerConfirmedCapture({ transaction: tx, payment: canonical, paymentIntentId: d.checkoutId });
    // All reads precede writes. The immutable provider binding gates every commercial effect.
    tx.create(bindingRef, { provider: 'mercado_pago', providerPaymentId: String(payment.id), storeId, subscriptionId: id, contractId, contractPath: contractRef.path });
    tx.create(contractRef, { contractId, checkoutId: d.checkoutId, subscriptionId: id, storeId, customerId: uid,
      productId: d.offer.productId, months: d.offer.quote.months, totalPaidMinor: d.offer.quote.totalMinor,
      monthlyBasePriceMinor: d.offer.priceMinor, discountPercent: d.offer.quote.discountPercent,
      acceptedAt: d.acceptedAt, startsAt, expiresAt, providerPaymentId: String(payment.id) });
    tx.create(subscriptionRef, { schemaVersion: 1, id, storeId, buyerId: uid, buyerEmail: d.buyerEmail,
      ownerUserId: d.offer.ownerUserId, legacyStoreId: d.offer.legacyStoreId, productId: d.offer.productId, productName: d.offer.productName,
      collectionMode: 'prepaid', contractedMonths: d.offer.quote.months, amountMinor: d.offer.quote.totalMinor,
      monthlyBasePriceMinor: d.offer.priceMinor, currency: 'BRL',
      saleModality: { ...d.offer.saleModality, subscription: { ...d.offer.saleModality.subscription, autoRenew: false } },
      provider: 'mercado_pago', providerSubscriptionId: '', providerStatus: 'authorized', state: 'active', checkoutUrl: '',
      credentialScopeId: 'kyrub_platform_billing', externalAccountId: d.collectorId, externalReference: reference(d.checkoutId),
      providerInvoiceId: '', providerPaymentId: String(payment.id), providerPaymentStatus: 'approved', providerPaymentStatusDetail: 'accredited',
      providerPaymentOccurredAt: startsAt, paymentConfirmedAt: startsAt, createdAt: startsAt, updatedAt: startsAt, activatedAt: startsAt,
      cancelledAt: '', startsAt, expiresAt, initialContractId: contractId, billingAuthority: 'platform' });
    tx.create(subscriptionRef.collection('prepaidPeriods').doc(contractId), { contractId, storeId, subscriptionId: id,
      buyerId: uid, productId: d.offer.productId, startsAt, expiresAt, providerPaymentId: String(payment.id), paidAmountMinor: d.offer.quote.totalMinor, state: 'paid' });
    tx.create(adminDb.doc(`${root}/payments/${paymentId}`), canonical);
    applyStoreEconomicLedgerPaymentPlan(tx, finance);
    if (pointEntry) tx.create(adminDb.doc(`${root}/storePointLedger/${Buffer.from(pointEntry.id).toString('base64url')}`), pointEntry);
    writePlanMirrors(tx, uid, d.buyerStoreId, d.offer.plan, FieldValue.serverTimestamp());
    tx.set(entitlementRef(uid), { schemaVersion: 2, storeId: uid, ownerId: uid, plan: d.offer.plan,
      planVersion: d.offer.planVersion, source: 'subscription', status: 'active', benefitStartsAt: startsAt, benefitEndsAt: expiresAt,
      provider: 'mercado_pago', providerPaymentId: String(payment.id), officialPixCheckoutId: d.checkoutId, updatedAt: FieldValue.serverTimestamp() });
    tx.set(slotRef(uid), { checkoutReservationStatus: 'complete', collectionMode: 'prepaid', officialPixCheckoutId: d.checkoutId,
      expiresAt, providerPaymentId: String(payment.id), providerStatus: 'authorized', providerSubscriptionId: '', updatedAt: startsAt }, { merge: true });
    tx.update(r, { status: 'activated', subscriptionId: id, contractId, startsAt, contractExpiresAt: expiresAt, effectsStatus: 'pending' });
    tx.create(adminDb.doc(`${ROOT}/audit_logs/official_pix_${d.checkoutId}`), { action: 'store.subscription.activated',
      actorId: 'kyrub_billing', actorRole: 'system', targetType: 'store', targetId: uid, nextPlan: d.offer.plan,
      providerPaymentId: String(payment.id), checkoutId: d.checkoutId, source: 'server', createdAt: startsAt });
  });
  // Retry-safe projections use their canonical owners; a failed projection does not create another payment.
  if (d.offer.rewards.xp > 0) await persistVerifiedKyrubXp({ userId: uid, sourceType: 'achievement', sourceId: d.offer.productId,
    deltaXp: d.offer.rewards.xp, correlationId: d.checkoutId, idempotencyKey: `official_${d.checkoutId}`, occurredAt: startsAt });
  const achievement = d.offer.rewards.achievement;
  if (achievement) await adminDb.runTransaction(async tx => {
    const r = adminDb.doc(`users/${uid}/achievements/${achievement.id}`), existing = await tx.get(r);
    if (existing.exists) {
      if (existing.get('userId') !== uid) throw Error('OFFICIAL_PIX_ACHIEVEMENT_CONFLICT');
      return;
    }
    tx.create(r, { ...achievement, userId: uid, sourceType: 'official_plan_purchase',
      sourceId: d.offer.productId, checkoutId: d.checkoutId, providerPaymentId: String(payment.id), occurredAt: startsAt });
  });
  await reconcilePaidSubscriberIntoCrm(storeId, uid);
  await reconcileStoreSubscriptionBenefitCycle(storeId, id);
  await checkoutRef(d.checkoutId).update({ effectsStatus: 'complete' });
  console.info('[official-plan-pix]', { checkoutId: d.checkoutId, stage: 'activated', paymentId: String(payment.id) });
  return { state: 'activated', subscriptionId: id, contractId, startsAt, expiresAt,
    rewards: { xp: d.offer.rewards.xp, points: d.offer.points, ...(achievement ? { achievementTitle: achievement.title } : {}) } };
}

async function reconcileLoaded(d: any, candidateId?: string) {
  if (!d.acceptedAt || digest(d.offer) !== d.offerDigest) throw Error('OFFICIAL_PIX_ACCEPTANCE_REQUIRED');
  if (!d.requestDigest) return { state: 'recovery_required' };
  if (await officialPlanPixAccount() !== d.collectorId) throw Error('OFFICIAL_PIX_ACCOUNT_CHANGED');
  let paymentId = d.providerPaymentId || candidateId;
  if (!paymentId) {
    const found = await officialPlanPixRequest(`/v1/payments/search?${new URLSearchParams({ external_reference: reference(d.checkoutId), limit: '2', offset: '0' })}`);
    if (found?.paging?.total !== 1 || found.results?.length !== 1) return { state: 'recovery_required' };
    validatePayment(found.results[0], d); paymentId = String(found.results[0].id);
  }
  if (!/^\d{1,32}$/.test(paymentId)) throw Error('OFFICIAL_PIX_INVALID_PAYMENT');
  const payment = await officialPlanPixRequest(`/v1/payments/${paymentId}`);
  validatePayment(payment, d);
  if (String(payment.id) !== paymentId) throw Error('OFFICIAL_PIX_PAYMENT_MISMATCH');
  await bind(d, paymentId);
  if (payment.status === 'approved') {
    const verified = { ...d, providerPaymentId: paymentId };
    return d.buyerStoreProvisioningRequired
      ? materializePendingStoreActivation(verified, payment)
      : materialize(verified, payment);
  }
  if (['activated', 'paid_pending_activation'].includes(d.status)) throw Error('OFFICIAL_PIX_POST_PAYMENT_REVIEW_REQUIRED');
  if (['rejected', 'cancelled'].includes(payment.status)) {
    await adminDb.runTransaction(async tx => {
      const r = checkoutRef(d.checkoutId), slot = slotRef(d.buyerId);
      const [current, lock] = await Promise.all([tx.get(r), tx.get(slot)]);
      if (current.get('status') === 'activated') throw Error('OFFICIAL_PIX_POST_PAYMENT_REVIEW_REQUIRED');
      tx.update(r, { status: 'rejected', providerPaymentId: paymentId });
      if (lock.get('officialPixCheckoutId') === d.checkoutId) tx.set(slot, { checkoutReservationStatus: 'closed', providerStatus: 'cancelled' }, { merge: true });
    });
    return { state: 'rejected', paymentId };
  }
  if (!['pending', 'in_process'].includes(payment.status)) throw Error('OFFICIAL_PIX_POST_PAYMENT_REVIEW_REQUIRED');
  const qr = payment.point_of_interaction?.transaction_data?.qr_code;
  if (typeof qr !== 'string' || !qr.trim() || qr.length > 10000 || Date.parse(d.expiresAt) <= Date.now()) return { state: 'recovery_required', paymentId };
  return { state: 'awaiting_payment', paymentId, pix: { qrCode: qr, expiresAt: d.expiresAt } };
}

export async function reconcileOfficialPlanPix(input: { authorization: string; checkoutId: string }) {
  const { d } = await load(input.authorization, input.checkoutId);
  return reconcileLoaded(d);
}

export async function handleOfficialPlanPixWebhook(input: { headers: Record<string, string | string[] | undefined>; checkoutId: string; dataId: string }) {
  verifyOfficialPlanPixSignature(input.headers, input.dataId); checkId(input.checkoutId);
  if (!/^\d{1,32}$/.test(input.dataId)) throw Error('OFFICIAL_PIX_INVALID_PAYMENT');
  const d = (await checkoutRef(input.checkoutId).get()).data();
  if (!d || !['in_flight', 'outcome_unknown', 'bound', 'activated', 'paid_pending_activation'].includes(d.status)) return { processed: false };
  if (d.providerPaymentId && d.providerPaymentId !== input.dataId) throw Error('OFFICIAL_PIX_PAYMENT_MISMATCH');
  return { processed: true, ...await reconcileLoaded(d, input.dataId) };
}
