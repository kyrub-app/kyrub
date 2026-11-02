import { calculateSubscriptionContractOffer, type ContractTermMonths } from './subscriptionContractOffers.js';

/** An accepted quote is a historical snapshot, never recalculated from the catalog. */
export interface AcceptedSubscriptionContract {
  contractId: string;
  customerId: string;
  productId: string;
  storeId: string;
  months: ContractTermMonths;
  monthlyBasePriceMinor: number;
  discountPercent: number;
  totalPaidMinor: number;
  acceptedAt: string;
  expiresAt: string;
}

export interface SubscriptionRenewalProposal {
  previousContractId: string;
  customerId: string;
  productId: string;
  months: ContractTermMonths;
  /** Proposal is bound to the seller and cannot be accepted in another tenant. */
  storeId: string;
  currentMonthlyPriceMinor: number;
  discountPercent: number;
  totalDueMinor: number;
  status: 'awaiting_acceptance';
}

export const createSubscriptionRenewalProposal = (
  contract: AcceptedSubscriptionContract,
  currentMonthlyPriceMinor: number,
  renewalDiscountPercent = 0
): SubscriptionRenewalProposal => {
  if (!contract.contractId || !contract.customerId || !contract.productId || !contract.storeId ||
      !Number.isSafeInteger(contract.totalPaidMinor) || contract.totalPaidMinor < 0 ||
      !Number.isFinite(Date.parse(contract.expiresAt))) {
    throw new Error('INVALID_EXISTING_CONTRACT');
  }
  const offer = calculateSubscriptionContractOffer(
    currentMonthlyPriceMinor, contract.months, renewalDiscountPercent
  );
  return {
    previousContractId: contract.contractId,
    customerId: contract.customerId,
    productId: contract.productId,
    storeId: contract.storeId,
    months: contract.months,
    currentMonthlyPriceMinor,
    discountPercent: renewalDiscountPercent,
    totalDueMinor: offer.totalMinor,
    status: 'awaiting_acceptance',
  };
};

/** A renewal cannot be paid or activated without a separately recorded acceptance. */
export const acceptSubscriptionRenewalProposal = (
  proposal: SubscriptionRenewalProposal,
  acceptance: { customerId: string; storeId: string; acceptedTotalMinor: number; acceptedAt: string }
) => {
  if (proposal.status !== 'awaiting_acceptance' ||
      acceptance.customerId !== proposal.customerId ||
      acceptance.storeId !== proposal.storeId ||
      acceptance.acceptedTotalMinor !== proposal.totalDueMinor ||
      !Number.isFinite(Date.parse(acceptance.acceptedAt))) {
    throw new Error('RENEWAL_ACCEPTANCE_REQUIRED');
  }
  return { ...proposal, status: 'accepted' as const, acceptedAt: acceptance.acceptedAt };
};

/** Only a provider-confirmed full payment can fulfill an accepted prepaid renewal. */
export const confirmPrepaidRenewalPayment = (
  accepted: ReturnType<typeof acceptSubscriptionRenewalProposal>,
  payment: { providerPaymentId: string; status: string; amountMinor: number; verifiedByProvider: boolean }
) => {
  if (accepted.status !== 'accepted' || accepted.months === 1 ||
      !payment.verifiedByProvider || payment.status !== 'approved' ||
      !payment.providerPaymentId || !Number.isSafeInteger(payment.amountMinor) ||
      payment.amountMinor !== accepted.totalDueMinor) {
    throw new Error('RENEWAL_PAYMENT_NOT_CONFIRMED');
  }
  return { ...accepted, status: 'paid' as const, providerPaymentId: payment.providerPaymentId };
};

/** Snapshot to persist atomically with the accepted proposal, never from mutable catalog fields. */
export const snapshotAcceptedPrepaidRenewal = (
  paid: ReturnType<typeof confirmPrepaidRenewalPayment>,
  input: { newContractId: string; startsAt: string; expiresAt: string }
): AcceptedSubscriptionContract & { providerPaymentId: string; previousContractId: string } => {
  const start = Date.parse(input.startsAt);
  const end = Date.parse(input.expiresAt);
  if (!input.newContractId || input.newContractId === paid.previousContractId ||
      !Number.isFinite(start) || !Number.isFinite(end) || end <= start) {
    throw new Error('INVALID_RENEWAL_CONTRACT_DATES');
  }
  return {
    contractId: input.newContractId,
    previousContractId: paid.previousContractId,
    customerId: paid.customerId,
    productId: paid.productId,
    storeId: paid.storeId,
    months: paid.months,
    monthlyBasePriceMinor: paid.currentMonthlyPriceMinor,
    discountPercent: paid.discountPercent,
    totalPaidMinor: paid.totalDueMinor,
    acceptedAt: paid.acceptedAt,
    startsAt: input.startsAt,
    expiresAt: input.expiresAt,
    providerPaymentId: paid.providerPaymentId,
  };
};
