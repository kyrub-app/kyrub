/**
 * Marketplace commercial policy proposal, not an active billing configuration.
 *
 * Do not apply these values to Pix charges, payouts or payment intent totals
 * until the server has an authoritative activation timestamp, a signed fee
 * policy version, a delivery quote and a reconciliation path.
 */
export const MARKETPLACE_LAUNCH_POLICY_PROPOSAL = Object.freeze({
  policyId: 'marketplace-launch-v1-proposal',
  merchantCommissionBasisPoints: 700,
  merchantCommissionExemptionMonths: 3,
  consumerServiceFeeMinor: 100,
  currency: 'BRL',
  commissionBase: 'eligible_product_total_after_discounts',
  excludeFromCommission: ['delivery_fee', 'consumer_service_fee'],
  exemptionStartEvent: 'first_successful_store_activation',
  exemptionDoesNotResetOnReactivation: true,
  paymentSplitMode: 'seller_account_with_separate_courier_payable',
  automaticMultiRecipientSplitEnabled: false,
} as const);

/**
 * Pure, cent-based quote for previews and future server-side verification.
 * This does not authorize a charge or a payout.
 */
export const quoteMarketplaceLaunchPolicy = (input: {
  eligibleProductsMinor: number;
  merchantExempt: boolean;
}): {
  merchantCommissionMinor: number;
  consumerServiceFeeMinor: number;
} => {
  if (!Number.isSafeInteger(input.eligibleProductsMinor) || input.eligibleProductsMinor < 0) {
    throw new Error('Invalid eligible product total in minor units.');
  }
  const merchantCommissionMinor = input.merchantExempt
    ? 0
    : Math.round(input.eligibleProductsMinor *
      MARKETPLACE_LAUNCH_POLICY_PROPOSAL.merchantCommissionBasisPoints / 10_000);
  return {
    merchantCommissionMinor,
    consumerServiceFeeMinor: MARKETPLACE_LAUNCH_POLICY_PROPOSAL.consumerServiceFeeMinor,
  };
};

/**
 * Preview-only exemption determination. Activation must be supplied by an
 * authoritative, immutable server-side record; store creation is not activation.
 * The anniversary is calculated in UTC calendar months, not as 90 days.
 */
export const isWithinMarketplaceCommissionExemption = (
  firstActivationIso: string,
  orderCreatedIso: string
): boolean => {
  const activation = new Date(firstActivationIso);
  const order = new Date(orderCreatedIso);
  if (!Number.isFinite(activation.getTime()) || !Number.isFinite(order.getTime())) {
    throw new Error('Valid activation and order timestamps are required.');
  }
  const end = new Date(activation.getTime());
  const targetMonthStart = new Date(Date.UTC(
    activation.getUTCFullYear(),
    activation.getUTCMonth() + MARKETPLACE_LAUNCH_POLICY_PROPOSAL.merchantCommissionExemptionMonths,
    1
  ));
  const lastDay = new Date(Date.UTC(
    targetMonthStart.getUTCFullYear(), targetMonthStart.getUTCMonth() + 1, 0
  )).getUTCDate();
  end.setTime(Date.UTC(
    targetMonthStart.getUTCFullYear(),
    targetMonthStart.getUTCMonth(),
    Math.min(activation.getUTCDate(), lastDay),
    activation.getUTCHours(),
    activation.getUTCMinutes(),
    activation.getUTCSeconds(),
    activation.getUTCMilliseconds()
  ));
  return order.getTime() >= activation.getTime() && order.getTime() < end.getTime();
};
