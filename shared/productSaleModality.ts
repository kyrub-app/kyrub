export type ProductSaleMode = 'one_time' | 'subscription';

export type SubscriptionBillingUnit = 'day' | 'week' | 'month' | 'year';

export type SubscriptionBenefitKind =
  | 'access'
  | 'usage_credits'
  | 'recurring_delivery';

export interface SubscriptionBillingInterval {
  unit: SubscriptionBillingUnit;
  count: number;
}

export interface SubscriptionBenefit {
  kind: SubscriptionBenefitKind;
  unitsPerCycle: number | null;
}

export interface ProductSubscriptionTerms {
  schemaVersion: 1;
  billingInterval: SubscriptionBillingInterval;
  benefit: SubscriptionBenefit;
  autoRenew: true;
}

export interface ProductSaleModality {
  schemaVersion: 1;
  mode: ProductSaleMode;
  subscription: ProductSubscriptionTerms | null;
}

export const ONE_TIME_PRODUCT_SALE_MODALITY: ProductSaleModality = Object.freeze({
  schemaVersion: 1,
  mode: 'one_time',
  subscription: null,
});

const clean = (value: unknown): string =>
  typeof value === 'string' ? value.trim() : '';

const positiveInteger = (value: unknown): number | null =>
  typeof value === 'number' && Number.isInteger(value) && value > 0
    ? value
    : null;

const isBillingUnit = (value: string): value is SubscriptionBillingUnit =>
  value === 'day' || value === 'week' || value === 'month' || value === 'year';

const isBenefitKind = (value: string): value is SubscriptionBenefitKind =>
  value === 'access' || value === 'usage_credits' || value === 'recurring_delivery';

export const buildSubscriptionSaleModality = (input: {
  billingUnit: SubscriptionBillingUnit;
  billingIntervalCount?: number;
  benefitKind: SubscriptionBenefitKind;
  unitsPerCycle?: number | null;
}): ProductSaleModality => {
  const count = positiveInteger(input.billingIntervalCount ?? 1);
  if (count === null) {
    throw new Error('PRODUCT_SUBSCRIPTION_INTERVAL_INVALID');
  }

  const unitsPerCycle =
    input.benefitKind === 'access'
      ? null
      : positiveInteger(input.unitsPerCycle);

  if (input.benefitKind !== 'access' && unitsPerCycle === null) {
    throw new Error('PRODUCT_SUBSCRIPTION_UNITS_INVALID');
  }

  return {
    schemaVersion: 1,
    mode: 'subscription',
    subscription: {
      schemaVersion: 1,
      billingInterval: {
        unit: input.billingUnit,
        count,
      },
      benefit: {
        kind: input.benefitKind,
        unitsPerCycle,
      },
      autoRenew: true,
    },
  };
};

export const parseProductSaleModality = (
  value: unknown
): ProductSaleModality | null => {
  // Existing products predate sale modality and remain one-time purchases.
  if (value === undefined || value === null) {
    return ONE_TIME_PRODUCT_SALE_MODALITY;
  }

  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const record = value as Record<string, unknown>;
  if (record.schemaVersion !== 1) return null;

  const mode = clean(record.mode);
  if (mode === 'one_time') {
    return record.subscription === null || record.subscription === undefined
      ? ONE_TIME_PRODUCT_SALE_MODALITY
      : null;
  }
  if (mode !== 'subscription') return null;

  const subscription = record.subscription;
  if (!subscription || typeof subscription !== 'object' || Array.isArray(subscription)) {
    return null;
  }
  const subscriptionRecord = subscription as Record<string, unknown>;
  if (subscriptionRecord.schemaVersion !== 1 || subscriptionRecord.autoRenew !== true) {
    return null;
  }

  const billingInterval = subscriptionRecord.billingInterval;
  if (!billingInterval || typeof billingInterval !== 'object' || Array.isArray(billingInterval)) {
    return null;
  }
  const billingRecord = billingInterval as Record<string, unknown>;
  const billingUnit = clean(billingRecord.unit);
  const billingCount = positiveInteger(billingRecord.count);
  if (!isBillingUnit(billingUnit) || billingCount === null) return null;

  const benefit = subscriptionRecord.benefit;
  if (!benefit || typeof benefit !== 'object' || Array.isArray(benefit)) return null;
  const benefitRecord = benefit as Record<string, unknown>;
  const benefitKind = clean(benefitRecord.kind);
  if (!isBenefitKind(benefitKind)) return null;

  const unitsPerCycle =
    benefitKind === 'access'
      ? benefitRecord.unitsPerCycle === null
        ? null
        : null
      : positiveInteger(benefitRecord.unitsPerCycle);

  if (benefitKind === 'access' && benefitRecord.unitsPerCycle !== null) return null;
  if (benefitKind !== 'access' && unitsPerCycle === null) return null;

  return buildSubscriptionSaleModality({
    billingUnit,
    billingIntervalCount: billingCount,
    benefitKind,
    unitsPerCycle,
  });
};

export const isSubscriptionSaleModality = (
  value: ProductSaleModality
): value is ProductSaleModality & { subscription: ProductSubscriptionTerms } =>
  value.mode === 'subscription' && value.subscription !== null;
