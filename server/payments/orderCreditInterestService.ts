import { adminDb } from '../firebaseAdmin.js';
import { quoteOrderCompensation, ORDER_COMPENSATION_SCOPE, ORDER_COMPENSATION_MAX_BONUS_PERCENT } from '../../shared/orderCompensationCredit.js';
import { inspectOrderCreditInterestRefundSafety, type PartialRefundGuard } from './orderCreditInterestRefundGuard.js';
import { loadOwnerStoreInstitutionalRepresentation } from '../store/storeInstitutionalIdentityService.js';
import { normalizeCanonicalPayment, type CanonicalPayment } from '../../src/utils/canonicalPayment.js';
import { buildStoreInstitutionalPrincipalId } from '../../shared/storeInstitutionalIdentity.js';
import { buildUserNotification, userNotificationPath } from '../../shared/userNotifications.js';
import { loadPublicStorefrontBySlug } from './marketplaceDiscoveryService.js';

const clean = (value: unknown): string => typeof value === 'string' ? value.trim() : '';
const validId = (value: string): boolean => /^[A-Za-z0-9_-]{1,128}$/.test(value);

/**
 * A failed refund flag is only eligible for a NON-BINDING consultation after
 * the separately audited failed-partial attempt and a fresh provider zero-refund
 * verification have passed. This never permits a refund, settlement or credit.
 */
export const isCreditInterestRefundStatusEligible = (
  status: unknown, mode: PartialRefundGuard['mode']
): boolean => {
  const value = clean(status);
  return value === '' || value === 'required' ||
    (value === 'failed' && mode === 'audited_failed_attempt');
};
const proposalPath = (storeId: string, orderId: string): string =>
  'stores/' + storeId + '/orderCreditInterestProposals/' + orderId;
const orderPath = (storeId: string, orderId: string): string =>
  'artifacts/' + storeId + '/public/data/customerOrders/' + orderId;

export type CreditInterestStatus = 'awaiting_response' | 'interested' | 'prefers_refund';
export interface CreditInterestProposal {
  schemaVersion: 1;
  storeId: string;
  orderId: string;
  buyerId: string;
  paymentId: string;
  paymentStoreId: string;
  canonicalStoreId: string;
  amountMinor: number;
  scope: typeof ORDER_COMPENSATION_SCOPE;
  bonusPercent: number;
  bonusMinor: number;
  proposedCreditMinor: number;
  status: CreditInterestStatus;
  creditIssued: false;
  offeredAt: string;
  offeredBy: string;
  respondedAt: string;
}

const assertIds = (storeId: string, orderId: string): void => {
  if (!validId(storeId) || !validId(orderId)) {
    throw new Error('CREDIT_INTEREST_INVALID_TARGET');
  }
};

type CreditStorePublicIdentity = {
  /** Where the store's payment ledger may live. */
  catalogStoreId: string;
  /** The ID actually returned to buyers by the public storefront. */
  publicStoreId: string;
  storeSlug: string;
};

const validSlug = (value: string): boolean => /^[a-zA-Z0-9-]{1,128}$/.test(value);

/**
 * A published first store has THREE distinct identities:
 * - owner UID, used by legacy ERP orders;
 * - stores/{canonicalStoreId}, used for catalog / sometimes payments;
 * - marketplace_listings/{listingId}.storeId, used by the buyer storefront.
 * Do not assume the catalog document owns the public slug, and NEVER let the
 * client supply the owner alias. Verify each server-owned link independently.
 */
const resolveCreditInterestPublicStore = async (
  legacyStoreId: string
): Promise<CreditStorePublicIdentity> => {
  if (!validId(legacyStoreId)) throw new Error('CREDIT_INTEREST_STORE_UNVERIFIED');
  const [tenant, primary] = await Promise.all([
    adminDb.doc('tenants/' + legacyStoreId).get(),
    adminDb.doc('users/' + legacyStoreId + '/stores/' + legacyStoreId).get(),
  ]);
  if (!primary.exists || clean(primary.get('id')) !== legacyStoreId ||
      clean(primary.get('ownerId')) !== legacyStoreId ||
      (tenant.exists && clean(tenant.get('ownerId')) &&
        clean(tenant.get('ownerId')) !== legacyStoreId)) {
    throw new Error('CREDIT_INTEREST_STORE_UNVERIFIED');
  }

  const tenantLink = clean(tenant.get('canonicalStoreId'));
  const primaryLink = clean(primary.get('canonicalStoreId'));
  const links = [...new Set([tenantLink, primaryLink].filter(v => v && v !== legacyStoreId))];
  if (links.length > 1 || links.some(id => !validId(id))) {
    throw new Error('CREDIT_INTEREST_STORE_UNVERIFIED');
  }
  const catalogStoreId = links[0] || legacyStoreId;
  const catalog = await adminDb.doc('stores/' + catalogStoreId).get();
  if (catalogStoreId !== legacyStoreId &&
      (!catalog.exists || clean(catalog.get('ownerId')) !== legacyStoreId)) {
    throw new Error('CREDIT_INTEREST_STORE_UNVERIFIED');
  }
  // A verified first-store publication must retain the authoritative owner
  // and must not be silently replaced with a paused catalog projection.
  if (primaryLink && primaryLink !== legacyStoreId && catalog.get('firstStoreCreationVerified') === true &&
      (clean(catalog.get('legacyTenantId')) !== legacyStoreId ||
       clean(catalog.get('publicationStatus')) !== 'published')) {
    throw new Error('CREDIT_INTEREST_STORE_UNVERIFIED');
  }

  const candidates = [...new Set([legacyStoreId, catalogStoreId])];
  const listingsById = await Promise.all(candidates.map(storeId =>
    adminDb.collection('marketplace_listings').where('storeId', '==', storeId).limit(9).get()
  ));
  if (listingsById.some(snapshot => snapshot.size >= 9)) {
    throw new Error('CREDIT_INTEREST_STORE_UNVERIFIED');
  }
  const storeListings = listingsById.flatMap(snapshot =>
    snapshot.docs.filter(document => document.get('listingType') === 'store')
  );
  if (storeListings.length > 1) {
    throw new Error('CREDIT_INTEREST_STORE_UNVERIFIED');
  }
  if (storeListings.length === 1) {
    const listing = storeListings[0];
    const publicStoreId = clean(listing.get('storeId'));
    const storeSlug = clean(listing.get('slug'));
    if (!candidates.includes(publicStoreId) ||
        clean(listing.get('ownerId')) !== legacyStoreId ||
        clean(listing.get('publicationStatus')) !== 'published' ||
        !validSlug(storeSlug)) {
      throw new Error('CREDIT_INTEREST_STORE_UNVERIFIED');
    }
    // Match the authoritative public reader, including paused / renamed stores
    // and duplicate slug precedence. Notification must never link elsewhere.
    const visible = await loadPublicStorefrontBySlug(storeSlug);
    if (!visible || visible.store.id !== publicStoreId ||
        visible.store.slug !== storeSlug) {
      throw new Error('CREDIT_INTEREST_STORE_UNVERIFIED');
    }
    return { catalogStoreId, publicStoreId, storeSlug };
  }

  // Backwards compatibility for stores that predate marketplace listings.
  // A non-published tenant may not silently override a canonical pause.
  const tenantSlug = clean(tenant.get('slug'));
  if (tenant.exists && clean(tenant.get('publicationStatus')) === 'published' &&
      validSlug(tenantSlug) &&
      (!clean(tenant.get('id')) || clean(tenant.get('id')) === legacyStoreId)) {
    const visible = await loadPublicStorefrontBySlug(tenantSlug);
    if (visible?.store.id === legacyStoreId && visible.store.slug === tenantSlug) {
      return {catalogStoreId, publicStoreId: legacyStoreId, storeSlug: tenantSlug};
    }
  }
  // Existing paid-store records used stores/{canonicalId}.slug before
  // marketplace listing publication; retain only owned non-paused records.
  const storeSlug = clean(catalog.get('slug'));
  if (catalog.exists && clean(catalog.get('ownerId')) === legacyStoreId &&
      clean(catalog.get('publicationStatus')) !== 'paused' && validSlug(storeSlug)) {
    return { catalogStoreId, publicStoreId: catalogStoreId, storeSlug };
  }
  throw new Error('CREDIT_INTEREST_STORE_UNVERIFIED');
};

/**
 * Resolve the buyer-facing public ID from server-owned listing/store records.
 * Never infer the owner from a client-provided owner UID.
 */
const ownerForCreditInterestPublicStore = async (publicStoreId: string): Promise<string> => {
  if (!validId(publicStoreId)) throw new Error('CREDIT_INTEREST_STORE_UNVERIFIED');
  const [listingRecords, canonical, tenant] = await Promise.all([
    adminDb.collection('marketplace_listings')
      .where('storeId', '==', publicStoreId).limit(9).get(),
    adminDb.doc('stores/' + publicStoreId).get(),
    adminDb.doc('tenants/' + publicStoreId).get(),
  ]);
  const listings = listingRecords.docs.filter(document =>
    document.get('listingType') === 'store');
  if (listingRecords.size >= 9 || listings.length > 1) {
    throw new Error('CREDIT_INTEREST_STORE_UNVERIFIED');
  }
  let ownerId = '';
  if (listings.length === 1) {
    if (clean(listings[0].get('publicationStatus')) !== 'published') {
      throw new Error('CREDIT_INTEREST_STORE_UNVERIFIED');
    }
    ownerId = clean(listings[0].get('ownerId'));
  } else if (canonical.exists) {
    ownerId = clean(canonical.get('ownerId'));
  } else if (tenant.exists && clean(tenant.get('publicationStatus')) === 'published' &&
      clean(tenant.get('ownerId')) === publicStoreId) {
    ownerId = publicStoreId;
  }
  if (!validId(ownerId)) throw new Error('CREDIT_INTEREST_STORE_UNVERIFIED');
  const resolved = await resolveCreditInterestPublicStore(ownerId);
  if (resolved.publicStoreId !== publicStoreId) {
    throw new Error('CREDIT_INTEREST_STORE_UNVERIFIED');
  }
  return ownerId;
};

const verifiedPaidPayment = async (
  legacyStoreId: string, canonicalStoreId: string, orderId: string
): Promise<CanonicalPayment> => {
  const roots = [...new Set([canonicalStoreId, legacyStoreId])];
  const snapshots = await Promise.all(roots.map(storeId =>
    adminDb.collection('stores/' + storeId + '/payments')
      .where('orderId', '==', orderId).limit(10).get()
  ));
  const all = snapshots.flatMap((snapshot, index) => snapshot.docs.map(document => {
    const storeId = roots[index];
    try {
      return normalizeCanonicalPayment({
        ...(document.data() as CanonicalPayment), id: document.id, storeId,
      });
    } catch { return null; }
  }));
  // Duplicate mirrors or inconsistent payments require manual reconciliation.
  if (snapshots.reduce((sum, item) => sum + item.size, 0) !== 1 ||
      all.length !== 1 || !all[0] ||
      all[0].status !== 'paid' || all[0].provider !== 'mercado-pago' ||
      !all[0].providerPaymentId) {
    throw new Error('CREDIT_INTEREST_PAYMENT_UNVERIFIED');
  }
  return all[0];
};

/**
 * Sends a non-binding consultation about a future store credit. This neither
 * issues a coupon nor changes the financial obligation or provider payment.
 * Full agreement and monetary compensation are separate, gated workflows.
 */
export const proposeOrderCreditInterest = async (input: {
  storeId: string;
  orderId: string;
  actorId: string;
  bonusPercent?: number;
}): Promise<CreditInterestProposal> => {
  const storeId = clean(input.storeId);
  const orderId = clean(input.orderId);
  const actorId = clean(input.actorId);
  const bonusPercent = input.bonusPercent ?? 0;
  // The paid value is never supplied by the client; only the bonus rate is.
  if (!Number.isInteger(bonusPercent) || bonusPercent < 0 || bonusPercent > ORDER_COMPENSATION_MAX_BONUS_PERCENT) {
    throw new Error('CREDIT_INTEREST_BONUS_INVALID');
  }
  assertIds(storeId, orderId);
  if (!validId(actorId)) throw new Error('CREDIT_INTEREST_INVALID_ACTOR');
  await loadOwnerStoreInstitutionalRepresentation({ storeId, authenticatedUserId: actorId });
  const { catalogStoreId, publicStoreId, storeSlug } =
    await resolveCreditInterestPublicStore(storeId);
  const canonicalStoreId = publicStoreId; // proposal field means buyer-facing storefront ID
  const payment = await verifiedPaidPayment(storeId, catalogStoreId, orderId);
  // Offering a non-binding consultation must not reuse the full-refund gate.
  // Audited failed attempts require a fresh independent provider check; no
  // partial refund or unresolved history can ever authorize a money movement.
  const refundGuard = await inspectOrderCreditInterestRefundSafety({
    legacyStoreId: storeId, orderId, payment,
  });
  const orderRef = adminDb.doc(orderPath(storeId, orderId));
  const paymentRef = adminDb.doc('stores/' + payment.storeId + '/payments/' + payment.id);
  const proposalRef = adminDb.doc(proposalPath(storeId, orderId));
  const fullRefundRef = adminDb.doc('stores/' + payment.storeId + '/paymentRefunds/' + payment.id);
  const attemptRef = refundGuard.mode === 'audited_failed_attempt'
    ? adminDb.doc('stores/' + storeId + '/paymentPartialRefunds/' + refundGuard.failedAttemptId)
    : null;
  const evidenceRef = refundGuard.mode === 'audited_failed_attempt'
    ? adminDb.doc('stores/' + storeId + '/orderRefundReconciliationEvidence/' + orderId)
    : null;
  const now = new Date().toISOString();

  return adminDb.runTransaction(async transaction => {
    const [orderSnapshot, paymentSnapshot, proposalSnapshot, fullRefundSnapshot,
      attemptSnapshot, evidenceSnapshot, partialSnapshots] = await Promise.all([
      transaction.get(orderRef),
      transaction.get(paymentRef),
      transaction.get(proposalRef),
      transaction.get(fullRefundRef),
      attemptRef ? transaction.get(attemptRef) : Promise.resolve(null),
      evidenceRef ? transaction.get(evidenceRef) : Promise.resolve(null),
      Promise.all(refundGuard.roots.map(root =>
        transaction.get(adminDb.collection('stores/' + root + '/paymentPartialRefunds')
          .where('orderId', '==', orderId).limit(51)))),
    ]);
    // The transaction prevents a concurrent local refund attempt or mutation
    // of the recorded failed attempt from authorizing an outdated proposal.
    if (fullRefundSnapshot.exists || partialSnapshots.some(snapshot => snapshot.size > 50)) {
      throw new Error('CREDIT_INTEREST_REFUND_UNRESOLVED');
    }
    const partialDocs = partialSnapshots.flatMap((snapshot, index) =>
      snapshot.docs.map(doc => ({ root: refundGuard.roots[index], doc })));
    if (refundGuard.mode === 'no_partial_history' && partialDocs.length !== 0) {
      throw new Error('CREDIT_INTEREST_REFUND_UNRESOLVED');
    }
    if (refundGuard.mode === 'audited_failed_attempt') {
      if (partialDocs.length !== 1 || partialDocs[0].root !== storeId ||
          partialDocs[0].doc.id !== refundGuard.failedAttemptId ||
          partialDocs[0].doc.get('status') !== 'failed' ||
          partialDocs[0].doc.get('providerRefundId') ||
          !attemptSnapshot?.exists || attemptSnapshot.get('status') !== 'failed' ||
          attemptSnapshot.get('providerRefundId') ||
          !evidenceSnapshot?.exists ||
          evidenceSnapshot.get('state') !== 'observed_no_refund_not_settled' ||
          evidenceSnapshot.get('failedAttemptId') !== refundGuard.failedAttemptId ||
          evidenceSnapshot.get('paymentId') !== payment.id ||
          evidenceSnapshot.get('providerPaymentId') !== payment.providerPaymentId ||
          evidenceSnapshot.get('providerAmountMinor') !== Math.round(payment.amount * 100) ||
          evidenceSnapshot.get('paymentRefunded') !== false ||
          evidenceSnapshot.get('creditIssued') !== false) {
        throw new Error('CREDIT_INTEREST_REFUND_UNRESOLVED');
      }
    }
    const order = orderSnapshot.data() as Record<string, unknown> | undefined;
    if (!orderSnapshot.exists || !order || clean(order.storeId) !== storeId ||
        clean(order.id) !== orderId || !['rejected', 'cancelled'].includes(clean(order.status)) ||
        clean(order.paymentStatus) !== 'paid' ||
        !isCreditInterestRefundStatusEligible(order.refundStatus, refundGuard.mode)) {
      throw new Error('CREDIT_INTEREST_ORDER_NOT_ELIGIBLE');
    }
    const buyerId = clean(order.buyerId) || clean(order.createdByUserId);
    if (!validId(buyerId) || buyerId === actorId ||
        (clean(order.createdByUserId) && clean(order.buyerId) &&
          clean(order.createdByUserId) !== clean(order.buyerId))) {
      throw new Error('CREDIT_INTEREST_BUYER_UNVERIFIED');
    }
    if (!paymentSnapshot.exists || clean(paymentSnapshot.get('status')) !== 'paid' ||
        clean(paymentSnapshot.get('orderId')) !== orderId ||
        clean(paymentSnapshot.get('buyerId')) !== buyerId ||
        clean(paymentSnapshot.get('provider')) !== 'mercado-pago' ||
        clean(paymentSnapshot.get('providerPaymentId')) !== payment.providerPaymentId ||
        Math.round(Number(paymentSnapshot.get('amount')) * 100) !== Math.round(payment.amount * 100) ||
        payment.amount <= 0) {
      throw new Error('CREDIT_INTEREST_PAYMENT_CHANGED');
    }
    if (proposalSnapshot.exists) {
      const previous = proposalSnapshot.data() as CreditInterestProposal;
      if (previous.schemaVersion !== 1 || previous.storeId !== storeId ||
          previous.orderId !== orderId || previous.buyerId !== buyerId ||
          previous.paymentId !== payment.id || previous.paymentStoreId !== payment.storeId ||
          previous.canonicalStoreId !== canonicalStoreId ||
          previous.amountMinor !== Math.round(payment.amount * 100) ||
          previous.scope !== ORDER_COMPENSATION_SCOPE ||
          previous.bonusPercent !== bonusPercent) {
        throw new Error('CREDIT_INTEREST_PROPOSAL_CONFLICT');
      }
      return previous;
    }
    const amountMinor = Math.round(payment.amount * 100);
    const quote = quoteOrderCompensation({ paidMinor: amountMinor, bonusPercent });
    const proposal: CreditInterestProposal = {
      schemaVersion: 1, storeId, orderId, buyerId, paymentId: payment.id,
      paymentStoreId: payment.storeId, canonicalStoreId, amountMinor,
      scope: quote.scope, bonusPercent: quote.bonusPercent,
      bonusMinor: quote.bonusMinor, proposedCreditMinor: quote.totalCreditMinor,
      status: 'awaiting_response', creditIssued: false,
      offeredAt: now, offeredBy: actorId, respondedAt: '',
    };
    const notification = buildUserNotification({
      recipientUserId: buyerId, category: 'order',
      eventType: 'credit_interest_proposed', sourceId: orderId,
      actorPrincipalId: buildStoreInstitutionalPrincipalId(storeId),
      title: 'Proposta sobre pedido cancelado',
      body: 'A loja propôs consultar seu interesse em um crédito em reais para compras futuras nessa loja, com possível bônus. Consulte os valores na vitrine. Nenhum crédito foi emitido; você ainda pode preferir o reembolso.',
      target: { kind: 'storefront', storeId: canonicalStoreId, storeSlug, customerId: buyerId, orderId },
      createdAt: now,
    });
    transaction.create(proposalRef, proposal);
    transaction.create(adminDb.doc(userNotificationPath(buyerId, notification.id)), notification);
    return proposal;
  });
};

/** Owner reads the current proposal status without resending or modifying it. */
export const loadOwnerCreditInterestProposal = async (input: {
  storeId: string;
  orderId: string;
  actorId: string;
}): Promise<CreditInterestProposal | null> => {
  const storeId = clean(input.storeId);
  const orderId = clean(input.orderId);
  const actorId = clean(input.actorId);
  assertIds(storeId, orderId);
  if (!validId(actorId)) throw new Error('CREDIT_INTEREST_INVALID_ACTOR');
  await loadOwnerStoreInstitutionalRepresentation({ storeId, authenticatedUserId: actorId });
  const snapshot = await adminDb.doc(proposalPath(storeId, orderId)).get();
  if (!snapshot.exists) return null;
  const proposal = snapshot.data() as CreditInterestProposal;
  if (proposal.schemaVersion !== 1 || proposal.storeId !== storeId ||
      proposal.orderId !== orderId || snapshot.id !== orderId ||
      !validId(proposal.buyerId) || proposal.scope !== ORDER_COMPENSATION_SCOPE ||
      proposal.creditIssued !== false) {
    throw new Error('CREDIT_INTEREST_PROPOSAL_CONFLICT');
  }
  return proposal;
};

export const listOwnCreditInterestProposals = async (input: {
  storeId: string;
  buyerId: string;
}): Promise<CreditInterestProposal[]> => {
  const storeId = clean(input.storeId);
  const buyerId = clean(input.buyerId);
  if (!validId(storeId) || !validId(buyerId)) throw new Error('CREDIT_INTEREST_INVALID_TARGET');
  // The storefront ID may be the owner UID (published first store), while
  // payments live under an independent canonical catalog ID. Both identities
  // must resolve through the published server-owned links.
  const legacyStoreId = await ownerForCreditInterestPublicStore(storeId);
  const snapshot = await adminDb.collection('stores/' + legacyStoreId + '/orderCreditInterestProposals')
    .where('buyerId', '==', buyerId).limit(25).get();
  return snapshot.docs.flatMap(document => {
    const value = document.data() as CreditInterestProposal;
    return value.schemaVersion === 1 && value.buyerId === buyerId &&
      value.storeId === legacyStoreId && value.canonicalStoreId === storeId && value.orderId === document.id &&
      value.creditIssued === false && value.scope === ORDER_COMPENSATION_SCOPE &&
      Number.isSafeInteger(value.proposedCreditMinor) &&
      value.proposedCreditMinor > 0 ? [value] : [];
  });
};

export const respondToOrderCreditInterest = async (input: {
  storeId: string;
  orderId: string;
  buyerId: string;
  choice: 'interested' | 'prefers_refund';
}): Promise<CreditInterestProposal> => {
  const storeId = clean(input.storeId);
  const orderId = clean(input.orderId);
  const buyerId = clean(input.buyerId);
  assertIds(storeId, orderId);
  if (!validId(buyerId) || !['interested', 'prefers_refund'].includes(input.choice)) {
    throw new Error('CREDIT_INTEREST_RESPONSE_INVALID');
  }
  const ref = adminDb.doc(proposalPath(storeId, orderId));
  return adminDb.runTransaction(async transaction => {
    const snapshot = await transaction.get(ref);
    const proposal = snapshot.data() as CreditInterestProposal | undefined;
    if (!snapshot.exists || !proposal || proposal.schemaVersion !== 1 ||
        proposal.storeId !== storeId || proposal.orderId !== orderId ||
        proposal.buyerId !== buyerId || proposal.creditIssued !== false) {
      throw new Error('CREDIT_INTEREST_NOT_FOUND');
    }
    if (proposal.status === input.choice) return proposal;
    // A buyer who initially expressed interest may still prefer a cash refund
    // before a separate, definitive compensation agreement exists.
    if (proposal.status !== 'awaiting_response' &&
        !(proposal.status === 'interested' && input.choice === 'prefers_refund')) {
      throw new Error('CREDIT_INTEREST_ALREADY_RESPONDED');
    }
    if (!validId(proposal.paymentStoreId) || !validId(proposal.paymentId)) {
      throw new Error('CREDIT_INTEREST_PAYMENT_UNVERIFIED');
    }
    const paymentRef = adminDb.doc('stores/' + proposal.paymentStoreId + '/payments/' + proposal.paymentId);
    const orderRef = adminDb.doc(orderPath(storeId, orderId));
    const refundRef = adminDb.doc('stores/' + proposal.paymentStoreId + '/paymentRefunds/' + proposal.paymentId);
    const [paymentSnapshot, orderSnapshot, refundSnapshot] = await Promise.all([
      transaction.get(paymentRef), transaction.get(orderRef), transaction.get(refundRef),
    ]);
    if (!paymentSnapshot.exists || clean(paymentSnapshot.get('status')) !== 'paid' ||
        clean(paymentSnapshot.get('buyerId')) !== buyerId ||
        clean(paymentSnapshot.get('orderId')) !== orderId ||
        !orderSnapshot.exists || !['rejected','cancelled'].includes(clean(orderSnapshot.get('status'))) ||
        clean(orderSnapshot.get('paymentStatus')) !== 'paid' ||
        (input.choice === 'interested' && refundSnapshot.exists)) {
      throw new Error('CREDIT_INTEREST_PAYMENT_CHANGED');
    }
    const result: CreditInterestProposal = {
      ...proposal, status: input.choice, respondedAt: new Date().toISOString(),
    };
    transaction.update(ref, { status: result.status, respondedAt: result.respondedAt });
    return result;
  });
};
