/**
 * Human-reviewed, provisional cost attribution for returned deliveries.
 * This does not establish consumer liability or create financial obligations.
 */
export const DELIVERY_RETURN_LIABILITY_POLICY_ID = 'delivery_return_liability_v1' as const;
export const DELIVERY_RETURN_LIABILITY_POLICY_VERSION = 1 as const;
export const DELIVERY_RETURN_LIABILITY_CAUSES = [
  'store_failure',
  'platform_failure',
  'recipient_absent',
  'safety_incident',
  'courier_conduct_alleged',
  'damage_or_missing',
  'undetermined',
] as const;
export type DeliveryReturnLiabilityCause = typeof DELIVERY_RETURN_LIABILITY_CAUSES[number];
export type DeliveryReturnInitialFunding = 'store' | 'kyrub' | 'contingency' | 'disputed';
export type DeliveryReturnReceiptCondition = 'intact' | 'damaged' | 'disputed';

export interface DeliveryReturnLiabilityClassification {
  cause: DeliveryReturnLiabilityCause;
  initialFunding: DeliveryReturnInitialFunding;
  damageReviewRequired: boolean;
  recoverFromBuyer: false;
  deductFromCourier: false;
  financialExecutionAuthorized: false;
}

export const classifyDeliveryReturnLiability = (input: {
  cause: unknown;
  receivedCondition: unknown;
}): DeliveryReturnLiabilityClassification => {
  if (!DELIVERY_RETURN_LIABILITY_CAUSES.includes(input.cause as DeliveryReturnLiabilityCause)
      || !['intact','damaged','disputed'].includes(String(input.receivedCondition))) {
    throw new Error('DELIVERY_RETURN_LIABILITY_INVALID');
  }
  const cause = input.cause as DeliveryReturnLiabilityCause;
  const damageReviewRequired = input.receivedCondition !== 'intact';
  const expected: Record<DeliveryReturnLiabilityCause, DeliveryReturnInitialFunding> = {
    store_failure:'store',
    platform_failure:'kyrub',
    recipient_absent:'store',
    safety_incident:'contingency',
    courier_conduct_alleged:'disputed',
    damage_or_missing:'disputed',
    undetermined:'disputed',
  };
  // An alleged fault or damaged package is never a debit against a person.
  // In case of physical discrepancy, even a normally assignable cause
  // remains disputed until separate evidence and review are completed.
  return {
    cause,
    initialFunding: damageReviewRequired ? 'disputed' : expected[cause],
    damageReviewRequired,
    recoverFromBuyer:false,
    deductFromCourier:false,
    financialExecutionAuthorized:false,
  };
};

export const validateDeliveryReturnLiabilityJustification = (value: unknown): string => {
  if (typeof value !== 'string' || value.trim().length < 20
      || value.trim().length > 500) {
    throw new Error('DELIVERY_RETURN_LIABILITY_INVALID');
  }
  return value.trim();
};
