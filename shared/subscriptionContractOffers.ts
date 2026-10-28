/**
 * Contract offers are shared by every store. They extend the existing
 * ProductSaleModality rather than introducing a second subscription engine.
 * A term is a prepaid contract duration, not an installment schedule.
 */
export const CONTRACT_TERM_MONTHS = [1, 3, 6, 12] as const;
export type ContractTermMonths = typeof CONTRACT_TERM_MONTHS[number];

export interface SubscriptionContractOffer {
  months: ContractTermMonths;
  discountPercent: number;
  /** Amount due for the entire term, in minor currency units. */
  totalMinor: number;
  monthlyEquivalentMinor: number;
}

export const calculateSubscriptionContractOffer = (
  monthlyPriceMinor: number,
  months: ContractTermMonths,
  discountPercent: number
): SubscriptionContractOffer => {
  if (!Number.isSafeInteger(monthlyPriceMinor) || monthlyPriceMinor < 0 ||
      !CONTRACT_TERM_MONTHS.includes(months) ||
      !Number.isFinite(discountPercent) || discountPercent < 0 || discountPercent > 100 ||
      Math.round(discountPercent * 100) !== discountPercent * 100) {
    throw new Error('INVALID_SUBSCRIPTION_CONTRACT_OFFER');
  }
  // Round only once, on the total payable amount.
  const totalMinor = Math.round(monthlyPriceMinor * months * (1 - discountPercent / 100));
  return {
    months,
    discountPercent,
    totalMinor,
    monthlyEquivalentMinor: Math.round(totalMinor / months),
  };
};

export const validateSubscriptionContractDiscounts = (
  entries: readonly { months: ContractTermMonths; discountPercent: number }[]
): void => {
  if (entries.length === 0 || entries.length > CONTRACT_TERM_MONTHS.length) {
    throw new Error('INVALID_SUBSCRIPTION_CONTRACT_TERMS');
  }
  const seen = new Set<number>();
  for (const entry of entries) {
    if (seen.has(entry.months)) throw new Error('DUPLICATE_SUBSCRIPTION_CONTRACT_TERM');
    seen.add(entry.months);
    calculateSubscriptionContractOffer(0, entry.months, entry.discountPercent);
  }
};
