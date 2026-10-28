import { parseProductSaleModality } from '../../shared/productSaleModality.js';

export type PaidKyrubPlan = 'pro' | 'business';

export const matchesOfficialPlanProduct = (
  value: unknown,
  expectedPlan: PaidKyrubPlan,
  expectedAmountMinor: number
): boolean => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const data = value as Record<string, unknown>;
  const modality = parseProductSaleModality(data.saleModality);
  const price = typeof data.price === 'number' ? data.price : NaN;
  const amountMinor = Number.isFinite(price) ? Math.round(price * 100) : 0;
  return data.publicationStatus === 'published' &&
    data.kyrubPlanId === expectedPlan &&
    Number.isInteger(expectedAmountMinor) &&
    expectedAmountMinor > 0 &&
    amountMinor === expectedAmountMinor &&
    modality?.mode === 'subscription' &&
    modality.subscription?.billingInterval.unit === 'month' &&
    modality.subscription.billingInterval.count === 1 &&
    modality.subscription.benefit.kind === 'access';
};
