import { activatePrepaidContractAfterVerifiedPayment } from './prepaidSubscriptionContractLifecycle.js';
import {
  acceptSubscriptionRenewalProposal,
  confirmPrepaidRenewalPayment,
  snapshotAcceptedPrepaidRenewal,
  type SubscriptionRenewalProposal,
} from '../../shared/subscriptionContractRenewal.js';
import { persistVerifiedPrepaidRenewal } from './persistedPrepaidRenewal.js';

/**
 * Server-only composition boundary. Inputs MUST originate from an authenticated,
 * persisted acceptance and a freshly verified provider payment. Not an HTTP route.
 */
export const recordVerifiedPrepaidRenewal = async (input: {
  proposal: SubscriptionRenewalProposal;
  acceptance: Parameters<typeof acceptSubscriptionRenewalProposal>[1];
  payment: { id: string; status: string; amountMinor: number; occurredAt: string; verifiedByProvider: boolean };
  newContractId: string;
}) => {
  if (!input.payment.verifiedByProvider || input.payment.status !== 'approved') {
    throw new Error('RENEWAL_PAYMENT_NOT_CONFIRMED');
  }
  const accepted = acceptSubscriptionRenewalProposal(input.proposal, input.acceptance);
  const paid = confirmPrepaidRenewalPayment(accepted, {
    providerPaymentId: input.payment.id,
    status: input.payment.status,
    amountMinor: input.payment.amountMinor,
    verifiedByProvider: input.payment.verifiedByProvider,
  });
  const lifecycle = activatePrepaidContractAfterVerifiedPayment({
    state: 'pending_payment', months: paid.months, amountMinor: paid.totalDueMinor,
    providerPaymentId: '', paymentConfirmedAt: '', startsAt: '', expiresAt: '',
  }, input.payment);
  const snapshot = snapshotAcceptedPrepaidRenewal(paid, {
    newContractId: input.newContractId,
    startsAt: lifecycle.startsAt,
    expiresAt: lifecycle.expiresAt,
  });
  return persistVerifiedPrepaidRenewal(snapshot);
};
