import { adminDb } from '../firebaseAdmin.js';
import { quoteOrderCompensation, ORDER_COMPENSATION_SCOPE, ORDER_COMPENSATION_MAX_BONUS_PERCENT } from '../../shared/orderCompensationCredit.js';
import { assertFullRefundHasNoConfirmedPartialHistory } from './partialRefundSafetyService.js';
import { loadOwnerStoreInstitutionalRepresentation } from '../store/storeInstitutionalIdentityService.js';
import { normalizeCanonicalPayment, type CanonicalPayment } from '../../src/utils/canonicalPayment.js';
import { buildStoreInstitutionalPrincipalId } from '../../shared/storeInstitutionalIdentity.js';
import { buildUserNotification, userNotificationPath } from '../../shared/userNotifications.js';

const clean = (value: unknown): string => typeof value === 'string' ? value.trim() : '';
const validId = (value: string): boolean => /^[A-Za-z0-9_-]{1,128}$/.test(value);
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

const canonicalStoreForLegacyOwner = async (legacyStoreId: string): Promise<string> => {
  const tenant = await adminDb.doc('tenants/' + legacyStoreId).get();
  const canonicalId = clean(tenant.get('canonicalStoreId')) || legacyStoreId;
  if (!validId(canonicalId)) throw new Error('CREDIT_INTEREST_STORE_UNVERIFIED');
  if (canonicalId !== legacyStoreId) {
    const canonical = await adminDb.doc('stores/' + canonicalId).get();
    if (!canonical.exists || clean(canonical.get('ownerId')) !== legacyStoreId) {
      throw new Error('CREDIT_INTEREST_STORE_UNVERIFIED');
    }
  }
  return canonicalId;
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
  const canonicalStoreId = await canonicalStoreForLegacyOwner(storeId);
  const payment = await verifiedPaidPayment(storeId, canonicalStoreId, orderId);
  // Reject already partially refunded or uncertain histories. The principal
  // must represent an outstanding, fully paid transaction.
  await assertFullRefundHasNoConfirmedPartialHistory({ storeId: payment.storeId, orderId });
  const orderRef = adminDb.doc(orderPath(storeId, orderId));
  const paymentRef = adminDb.doc('stores/' + payment.storeId + '/payments/' + payment.id);
  const proposalRef = adminDb.doc(proposalPath(storeId, orderId));
  const now = new Date().toISOString();

  return adminDb.runTransaction(async transaction => {
    const [orderSnapshot, paymentSnapshot, proposalSnapshot] = await Promise.all([
      transaction.get(orderRef), transaction.get(paymentRef), transaction.get(proposalRef),
    ]);
    const order = orderSnapshot.data() as Record<string, unknown> | undefined;
    if (!orderSnapshot.exists || !order || clean(order.storeId) !== storeId ||
        clean(order.id) !== orderId || !['rejected', 'cancelled'].includes(clean(order.status)) ||
        clean(order.paymentStatus) !== 'paid' ||
        (clean(order.refundStatus) && !['required', ''].includes(clean(order.refundStatus)))) {
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
      target: { kind: 'storefront', storeId: canonicalStoreId, customerId: buyerId, orderId },
      createdAt: now,
    });
    transaction.create(proposalRef, proposal);
    transaction.set(adminDb.doc(userNotificationPath(buyerId, notification.id)), notification);
    return proposal;
  });
};

export const listOwnCreditInterestProposals = async (input: {
  storeId: string;
  buyerId: string;
}): Promise<CreditInterestProposal[]> => {
  const storeId = clean(input.storeId);
  const buyerId = clean(input.buyerId);
  if (!validId(storeId) || !validId(buyerId)) throw new Error('CREDIT_INTEREST_INVALID_TARGET');
  // A public storefront uses its canonical store ID; the operating ERP uses
  // the owner/tenant ID. Resolve only through the authenticated server-owned
  // canonical store record, never accept a buyer-supplied owner alias.
  const canonical = await adminDb.doc('stores/' + storeId).get();
  const legacyStoreId = clean(canonical.get('ownerId'));
  if (!canonical.exists || !validId(legacyStoreId)) {
    throw new Error('CREDIT_INTEREST_STORE_UNVERIFIED');
  }
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
    if (proposal.status !== 'awaiting_response') throw new Error('CREDIT_INTEREST_ALREADY_RESPONDED');
    if (!validId(proposal.paymentStoreId)) throw new Error('CREDIT_INTEREST_PAYMENT_UNVERIFIED');
    const paymentRef = adminDb.doc('stores/' + proposal.paymentStoreId + '/payments/' + proposal.paymentId);
    const paymentSnapshot = await transaction.get(paymentRef);
    if (!paymentSnapshot.exists || clean(paymentSnapshot.get('status')) !== 'paid') {
      throw new Error('CREDIT_INTEREST_PAYMENT_CHANGED');
    }
    const result: CreditInterestProposal = {
      ...proposal, status: input.choice, respondedAt: new Date().toISOString(),
    };
    transaction.update(ref, { status: result.status, respondedAt: result.respondedAt });
    return result;
  });
};
