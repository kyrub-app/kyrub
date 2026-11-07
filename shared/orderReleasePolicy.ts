/**
 * Shared decision policy for an approved order. This module does not execute
 * payment, activate subscriptions or dispatch anything to the KDS.
 * All decisions must be revalidated by the server against persisted state.
 */
export type OrderReleaseMode = 'pay_before_fulfillment' | 'open_tab';
export type OrderApprovalState = 'pending' | 'approved' | 'rejected';
export type OrderSettlementState = 'unpaid' | 'partial' | 'paid';

export const requiresServerOrderPersistence = (order: {
  releaseMode?: unknown; operationalRelease?: unknown;
}): boolean => order.releaseMode === 'pay_before_fulfillment' || order.operationalRelease !== undefined;

/** Server-issued projection; fulfillment endpoints still re-read the payment ledger. */
export interface PrepaidOperationalRelease {
  schemaVersion: 1;
  orderId: string;
  storeId: string;
  buyerId: string;
  paymentIntentId: string;
  paymentId: string;
  providerPaymentId: string;
  paymentEventKey: string;
  recipientAccountId: string;
  amountMinor: number;
  authorizedAt: string;
}

export const parsePrepaidOperationalRelease = (value: unknown): PrepaidOperationalRelease | null => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const record = value as Record<string, unknown>;
  if (record.schemaVersion !== 1 || !Number.isSafeInteger(record.amountMinor) || Number(record.amountMinor) <= 0) return null;
  for (const key of ['orderId', 'storeId', 'buyerId', 'paymentIntentId', 'paymentId', 'providerPaymentId', 'paymentEventKey', 'authorizedAt']) {
    if (typeof record[key] !== 'string' || !record[key].trim() || record[key].length > 1500) return null;
  }
  if (typeof record.recipientAccountId !== 'string' || record.recipientAccountId.length > 180 ||
      !Number.isFinite(Date.parse(record.authorizedAt as string))) return null;
  return record as unknown as PrepaidOperationalRelease;
};

export const isPrepaidOrderReleased = (order: {
  id: string; storeId: string; buyerId: string; status: string; paymentStatus: string; total: number;
  paymentIntentId?: string; paymentId?: string; operationalRelease?: unknown;
}): boolean => {
  const release = parsePrepaidOperationalRelease(order.operationalRelease);
  return Boolean(release && ['accepted', 'preparing', 'ready', 'out_for_delivery', 'completed'].includes(order.status) &&
    order.paymentStatus === 'paid' && release.orderId === order.id && release.storeId === order.storeId &&
    release.buyerId === order.buyerId && release.paymentIntentId === order.paymentIntentId && release.paymentId === order.paymentId &&
    release.amountMinor === Math.round(order.total * 100));
};

export interface OrderReleaseDecisionInput {
  mode: OrderReleaseMode;
  approval: OrderApprovalState;
  settlement: OrderSettlementState;
  paymentVerifiedByServer: boolean;
  orderCancelled?: boolean;
}

export interface OrderReleaseDecision {
  paymentAvailable: boolean;
  fulfillmentAuthorized: boolean;
  reason: 'pending_approval' | 'rejected' | 'cancelled' | 'open_tab_approved' | 'awaiting_verified_payment' | 'verified_payment';
}

export const resolveOrderReleaseDecision = (
  input: OrderReleaseDecisionInput
): OrderReleaseDecision => {
  if (input.orderCancelled) {
    return { paymentAvailable: false, fulfillmentAuthorized: false, reason: 'cancelled' };
  }
  if (input.approval === 'rejected') {
    return { paymentAvailable: false, fulfillmentAuthorized: false, reason: 'rejected' };
  }
  if (input.approval !== 'approved') {
    return { paymentAvailable: false, fulfillmentAuthorized: false, reason: 'pending_approval' };
  }
  if (input.mode === 'open_tab') {
    return { paymentAvailable: true, fulfillmentAuthorized: true, reason: 'open_tab_approved' };
  }
  if (input.settlement === 'paid' && input.paymentVerifiedByServer) {
    return { paymentAvailable: false, fulfillmentAuthorized: true, reason: 'verified_payment' };
  }
  return { paymentAvailable: true, fulfillmentAuthorized: false, reason: 'awaiting_verified_payment' };
};
