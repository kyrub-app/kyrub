import { adminDb } from '../firebaseAdmin.js';
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
  amountMinor: number;
  status: CreditInterestStatus;
  creditIssued: false;
  paymentRefunded: false;
  offeredAt: string;
  offeredBy: string;
  respondedAt: string;
}

const assertIds = (storeId: string, orderId: string): void => {
  if (!validId(storeId) || !validId(orderId)) {
    throw new Error('CREDIT_INTEREST_INVALID_TARGET');
  }
};

const verifiedPaidPayment = async (storeId: string, orderId: string): Promise<CanonicalPayment> => {
  const matches = await adminDb.collection('stores/' + storeId + '/payments')
    .where('orderId', '==', orderId).limit(10).get();
  const payments = matches.docs.flatMap(document => {
    try {
      const payment = normalizeCanonicalPayment({
        ...(document.data() as CanonicalPayment), id: document.id, storeId,
      });
      return payment.status === 'paid' && payment.provider === 'mercado-pago' &&
        payment.providerPaymentId ? [payment] : [];
    } catch { return []; }
  });
  // No offer when there is ambiguous, refunded, partial or non-authoritative payment.
  if (matches.size !== 1 || payments.length !== 1) {
    throw new Error('CREDIT_INTEREST_PAYMENT_UNVERIFIED');
  }
  return payments[0];
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
}): Promise<CreditInterestProposal> => {
  const storeId = clean(input.storeId);
  const orderId = clean(input.orderId);
  const actorId = clean(input.actorId);
  assertIds(storeId, orderId);
  if (!validId(actorId)) throw new Error('CREDIT_INTEREST_INVALID_ACTOR');
  const payment = await verifiedPaidPayment(storeId, orderId);
  const orderRef = adminDb.doc(orderPath(storeId, orderId));
  const paymentRef = adminDb.doc('stores/' + storeId + '/payments/' + payment.id);
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
          previous.paymentId !== payment.id) {
        throw new Error('CREDIT_INTEREST_PROPOSAL_CONFLICT');
      }
      return previous;
    }
    const amountMinor = Math.round(payment.amount * 100);
    if (!Number.isSafeInteger(amountMinor) || amountMinor <= 0) {
      throw new Error('CREDIT_INTEREST_AMOUNT_INVALID');
    }
    const proposal: CreditInterestProposal = {
      schemaVersion: 1, storeId, orderId, buyerId, paymentId: payment.id,
      amountMinor, status: 'awaiting_response', creditIssued: false,
      paymentRefunded: false, offeredAt: now, offeredBy: actorId, respondedAt: '',
    };
    const notification = buildUserNotification({
      recipientUserId: buyerId, category: 'order',
      eventType: 'credit_interest_proposed', sourceId: orderId,
      actorPrincipalId: buildStoreInstitutionalPrincipalId(storeId),
      title: 'Proposta sobre pedido cancelado',
      body: 'A loja quer consultar seu interesse em receber crédito para uma compra futura. Nenhum cupom foi emitido e você mantém a opção de devolução do pagamento.',
      target: { kind: 'storefront', storeId, customerId: buyerId, orderId },
      createdAt: now,
    });
    transaction.create(proposalRef, proposal);
    transaction.set(userNotificationPath(buyerId, notification.id)
      ? adminDb.doc(userNotificationPath(buyerId, notification.id))
      : proposalRef, notification);
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
  const snapshot = await adminDb.collection('stores/' + storeId + '/orderCreditInterestProposals')
    .where('buyerId', '==', buyerId).limit(25).get();
  return snapshot.docs.flatMap(document => {
    const value = document.data() as CreditInterestProposal;
    return value.schemaVersion === 1 && value.buyerId === buyerId &&
      value.storeId === storeId && value.orderId === document.id &&
      value.creditIssued === false ? [value] : [];
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
    const paymentRef = adminDb.doc('stores/' + storeId + '/payments/' + proposal.paymentId);
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
