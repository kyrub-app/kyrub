/**
 * Shared decision policy for an approved order. This module does not execute
 * payment, activate subscriptions or dispatch anything to the KDS.
 * All decisions must be revalidated by the server against persisted state.
 */
export type OrderReleaseMode = 'pay_before_fulfillment' | 'open_tab';
export type OrderApprovalState = 'pending' | 'approved' | 'rejected';
export type OrderSettlementState = 'unpaid' | 'partial' | 'paid';

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
