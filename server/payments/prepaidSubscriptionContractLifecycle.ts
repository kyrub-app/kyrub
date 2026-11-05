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

export const addMonthsUtc = (iso: string, months: number): string => {
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

/**
 * Prepaying an extension never forfeits the remaining time on the previous
 * contract. Expired contracts restart when the *verified* payment is approved.
 * A payment approved before explicit acceptance is not a valid renewal.
 */
export const calculatePrepaidRenewalPeriod = (input: {
  previousExpiresAt: string;
  acceptedAt: string;
  paymentApprovedAt: string;
  months: ContractTermMonths;
}): { startsAt: string; expiresAt: string } => {
  const parseInstant = (value: unknown): number => {
    if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}T/.test(value) ||
        !(value.endsWith('Z') || /[+-]\d{2}:\d{2}$/.test(value))) {
      throw new Error('INVALID_RENEWAL_PERIOD_TIMESTAMP');
    }
    const timestamp = Date.parse(value);
    if (!Number.isFinite(timestamp)) throw new Error('INVALID_RENEWAL_PERIOD_TIMESTAMP');
    return timestamp;
  };
  if (![3, 6, 12].includes(input.months)) throw new Error('INVALID_PREPAID_CONTRACT_TERM');
  const expiry = parseInstant(input.previousExpiresAt);
  const acceptance = parseInstant(input.acceptedAt);
  const payment = parseInstant(input.paymentApprovedAt);
  if (payment < acceptance) throw new Error('RENEWAL_PAYMENT_PRECEDES_ACCEPTANCE');
  const startsAt = new Date(Math.max(expiry, payment)).toISOString();
  return { startsAt, expiresAt: addMonthsUtc(startsAt, input.months) };
};
