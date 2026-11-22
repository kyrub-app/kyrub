/**
 * A compensatory store credit is denominated in Brazilian centavos and scoped
 * to the merchant, NOT to specific products or ordinary marketing coupons.
 * This module only quotes a proposal. There is no issuance, redemption or
 * payment settlement until the buyer explicitly accepts a separate agreement.
 */
export const ORDER_COMPENSATION_MAX_BONUS_PERCENT = 100;
export const ORDER_COMPENSATION_SCOPE = 'storewide' as const;

export interface OrderCompensationQuote {
  scope: typeof ORDER_COMPENSATION_SCOPE;
  principalMinor: number;
  bonusPercent: number;
  bonusMinor: number;
  totalCreditMinor: number;
}

const validMinor = (value: number): boolean =>
  Number.isSafeInteger(value) && value >= 0;

export const quoteOrderCompensation = (input: {
  paidMinor: number;
  bonusPercent: number;
}): OrderCompensationQuote => {
  if (!validMinor(input.paidMinor) || input.paidMinor <= 0) {
    throw new Error('ORDER_COMPENSATION_PRINCIPAL_INVALID');
  }
  // An initial bounded merchant-funded goodwill bonus. More complex bonus
  // policies must be individually approved, not enabled by a free-form value.
  if (!Number.isInteger(input.bonusPercent) ||
      input.bonusPercent < 0 ||
      input.bonusPercent > ORDER_COMPENSATION_MAX_BONUS_PERCENT) {
    throw new Error('ORDER_COMPENSATION_BONUS_INVALID');
  }
  const bonusMinor = Math.round(input.paidMinor * input.bonusPercent / 100);
  const totalCreditMinor = input.paidMinor + bonusMinor;
  if (!validMinor(bonusMinor) || !validMinor(totalCreditMinor)) {
    throw new Error('ORDER_COMPENSATION_AMOUNT_OVERFLOW');
  }
  return {
    scope: ORDER_COMPENSATION_SCOPE,
    principalMinor: input.paidMinor,
    bonusPercent: input.bonusPercent,
    bonusMinor,
    totalCreditMinor,
  };
};

/**
 * Pure arithmetic for the future transactional store-credit ledger. The
 * checkout cannot call this alone to authorize a credit or subtract money:
 * a server-side balance reservation/commit and provider reconciliation are
 * required before any real purchase.
 */
export const quoteFutureStoreCreditUse = (input: {
  availableMinor: number;
  purchaseTotalMinor: number;
}): { appliedMinor: number; balanceMinor: number; payableMinor: number } => {
  if (!validMinor(input.availableMinor) ||
      !validMinor(input.purchaseTotalMinor)) {
    throw new Error('ORDER_COMPENSATION_USE_INVALID');
  }
  const appliedMinor = Math.min(input.availableMinor, input.purchaseTotalMinor);
  return {
    appliedMinor,
    balanceMinor: input.availableMinor - appliedMinor,
    payableMinor: input.purchaseTotalMinor - appliedMinor,
  };
};
