import type { ContractTermMonths } from '../../shared/subscriptionContractOffers.js';

/** Pure, provider-neutral state transition used after verified payment reconciliation. */
export type PrepaidContractState = 'pending_payment' | 'active' | 'payment_failed' | 'cancelled';
export interface PrepaidContractLifecycle {
  state: PrepaidContractState;
  months: ContractTermMonths;
  amountMinor: number;
  providerPaymentId: string;
  paymentConfirmedAt: string;
  startsAt: string;
  expiresAt: string;
}

const addMonthsUtc = (iso: string, months: number): string => {
  const start = new Date(iso);
  if (!Number.isFinite(start.getTime()) || !iso.endsWith('Z')) throw new Error('INVALID_PAYMENT_TIMESTAMP');
  const year = start.getUTCFullYear();
  const month = start.getUTCMonth();
  const day = start.getUTCDate();
  const firstOfTarget = new Date(Date.UTC(year, month + months, 1,
    start.getUTCHours(), start.getUTCMinutes(), start.getUTCSeconds(), start.getUTCMilliseconds()));
  const lastDay = new Date(Date.UTC(firstOfTarget.getUTCFullYear(), firstOfTarget.getUTCMonth() + 1, 0)).getUTCDate();
  firstOfTarget.setUTCDate(Math.min(day, lastDay));
  return firstOfTarget.toISOString();
};

export const activatePrepaidContractAfterVerifiedPayment = (
  contract: PrepaidContractLifecycle,
  payment: { id: string; status: string; amountMinor: number; occurredAt: string; verifiedByProvider: boolean }
): PrepaidContractLifecycle => {
  if (!payment.verifiedByProvider || payment.status !== 'approved' ||
      !payment.id || !Number.isSafeInteger(payment.amountMinor) ||
      payment.amountMinor !== contract.amountMinor) {
    throw new Error('PREPAID_CONTRACT_PAYMENT_NOT_CONFIRMED');
  }
  if (contract.state === 'active') {
    if (contract.providerPaymentId === payment.id) return contract;
    throw new Error('PREPAID_CONTRACT_ALREADY_ACTIVATED');
  }
  if (contract.state !== 'pending_payment') throw new Error('PREPAID_CONTRACT_NOT_PENDING');
  if (![3, 6, 12].includes(contract.months)) throw new Error('INVALID_PREPAID_CONTRACT_TERM');
  const startsAt = new Date(payment.occurredAt).toISOString();
  return { ...contract, state: 'active', providerPaymentId: payment.id,
    paymentConfirmedAt: startsAt, startsAt, expiresAt: addMonthsUtc(startsAt, contract.months) };
};
