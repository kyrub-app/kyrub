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
      Math.abs(Math.round(discountPercent * 100) - discountPercent * 100) > 1e-8) {
    throw new Error('INVALID_SUBSCRIPTION_CONTRACT_OFFER');
  }
  // Round only once, on the total payable amount.
  const discountBasisPoints = Math.round(discountPercent * 100);
  const grossMinor = monthlyPriceMinor * months;
  if (!Number.isSafeInteger(grossMinor)) {
    throw new Error('INVALID_SUBSCRIPTION_CONTRACT_OFFER');
  }
  // Split whole and fractional cents to avoid unsafe intermediate products.
  const factor = 10000 - discountBasisPoints;
  const totalMinor = Math.floor(grossMinor / 10000) * factor +
    Math.round((grossMinor % 10000) * factor / 10000);
  if (!Number.isSafeInteger(totalMinor)) {
    throw new Error('INVALID_SUBSCRIPTION_CONTRACT_OFFER');
  }
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
  if (!entries.some(entry => entry.months === 1 && entry.discountPercent === 0)) {
    throw new Error('MISSING_MONTHLY_BASELINE');
  }
};

/** Strict persisted-offer parser shared by storefront and checkout. */
export const parseSubscriptionContractDiscounts = (
  value: unknown
): { months: ContractTermMonths; discountPercent: number }[] | null => {
  if (!Array.isArray(value)) return null;
  const offers: { months: ContractTermMonths; discountPercent: number }[] = [];
  for (const candidate of value) {
    if (!candidate || typeof candidate !== 'object' || Array.isArray(candidate)) return null;
    const record = candidate as Record<string, unknown>;
    if (typeof record.months !== 'number' ||
        !CONTRACT_TERM_MONTHS.includes(record.months as ContractTermMonths) ||
        typeof record.discountPercent !== 'number') return null;
    offers.push({
      months: record.months as ContractTermMonths,
      discountPercent: record.discountPercent,
    });
  }
  try {
    validateSubscriptionContractDiscounts(offers);
    return offers;
  } catch {
    return null;
  }
};
