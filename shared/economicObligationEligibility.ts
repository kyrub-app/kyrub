import {
  ECONOMIC_OBLIGATION_SCHEMA_VERSION,
  type EconomicObligation,
} from './economicObligations.js';

export const PICKUP_HANDOFF_ELIGIBILITY_AUTHORITY =
  'pickup_handoff_handed_over' as const;
export const DELIVERY_COMPLETION_ELIGIBILITY_AUTHORITY =
  'buyer_confirmed_delivery' as const;

export interface PickupHandoffEligibilityEvidence {
  storeId: string;
  orderId: string;
  verifiedAt: string;
  verifiedBy: string;
  handedOverAt: string;
  handedOverBy: string;
}

export interface DeliveryCompletionEligibilityEvidence {
  storeId: string;
  orderId: string;
  deliveryId: string;
  courierId: string;
  buyerId: string;
  confirmedAt: string;
}

export interface StoreReceivableEligibilityUpdate {
  status: 'eligible';
  eligibleAt: string;
  eligibility: {
    authority: typeof PICKUP_HANDOFF_ELIGIBILITY_AUTHORITY;
    reference: string;
    verifiedAt: string;
    verifiedBy: string;
    handedOverAt: string;
    handedOverBy: string;
  };
}

export interface CourierPayableEligibilityUpdate {
  status: 'eligible';
  eligibleAt: string;
  eligibility: {
    authority: typeof DELIVERY_COMPLETION_ELIGIBILITY_AUTHORITY;
    reference: string;
    buyerId: string;
    courierId: string;
    confirmedAt: string;
  };
}

const clean = (value: unknown): string =>
  typeof value === 'string' ? value.trim() : '';

const requireIso = (value: unknown, label: string): string => {
  const normalized = clean(value);
  if (!normalized || !Number.isFinite(Date.parse(normalized))) {
    throw new Error(`ECONOMIC_OBLIGATION_ELIGIBILITY_${label}_INVALID`);
  }
  return normalized;
};

export const buildStoreReceivablePickupEligibilityUpdate = (input: {
  obligation: EconomicObligation;
  evidence: PickupHandoffEligibilityEvidence;
}): StoreReceivableEligibilityUpdate => {
  const { obligation } = input;
  const storeId = clean(input.evidence.storeId);
  const orderId = clean(input.evidence.orderId);
  const verifiedAt = requireIso(input.evidence.verifiedAt, 'VERIFIED_AT');
  const handedOverAt = requireIso(input.evidence.handedOverAt, 'HANDED_OVER_AT');
  const createdAt = requireIso(obligation.createdAt, 'OBLIGATION_CREATED_AT');
  const verifiedBy = clean(input.evidence.verifiedBy);
  const handedOverBy = clean(input.evidence.handedOverBy);

  if (
    obligation.schemaVersion !== ECONOMIC_OBLIGATION_SCHEMA_VERSION ||
    obligation.kind !== 'store_receivable' ||
    obligation.beneficiaryType !== 'store' ||
    obligation.beneficiaryPrincipalId !== `store:${storeId}` ||
    obligation.currency !== 'BRL' ||
    !Number.isSafeInteger(obligation.amountMinor) ||
    obligation.amountMinor <= 0 ||
    obligation.storeId !== storeId ||
    obligation.orderId !== orderId ||
    obligation.fulfillmentId !== ''
  ) {
    throw new Error('ECONOMIC_OBLIGATION_ELIGIBILITY_RECEIVABLE_MISMATCH');
  }
  if (obligation.status !== 'pending') {
    throw new Error(
      `ECONOMIC_OBLIGATION_ELIGIBILITY_STATUS_INVALID:${obligation.status}`
    );
  }
  if (obligation.eligibleAt || obligation.settledAt || obligation.reversedAt) {
    throw new Error('ECONOMIC_OBLIGATION_ELIGIBILITY_LIFECYCLE_CONFLICT');
  }
  if (!verifiedBy || !handedOverBy) {
    throw new Error('ECONOMIC_OBLIGATION_ELIGIBILITY_ACTOR_REQUIRED');
  }
  if (Date.parse(handedOverAt) < Date.parse(verifiedAt)) {
    throw new Error('ECONOMIC_OBLIGATION_ELIGIBILITY_HANDOFF_ORDER_INVALID');
  }

  const eligibleAt = Date.parse(handedOverAt) >= Date.parse(createdAt)
    ? handedOverAt
    : createdAt;

  return {
    status: 'eligible',
    eligibleAt,
    eligibility: {
      authority: PICKUP_HANDOFF_ELIGIBILITY_AUTHORITY,
      reference: `order:${orderId}:pickup_handoff`,
      verifiedAt,
      verifiedBy,
      handedOverAt,
      handedOverBy,
    },
  };
};

export const buildCourierPayableDeliveryEligibilityUpdate = (input: {
  obligation: EconomicObligation;
  evidence: DeliveryCompletionEligibilityEvidence;
}): CourierPayableEligibilityUpdate => {
  const { obligation } = input;
  const storeId = clean(input.evidence.storeId);
  const orderId = clean(input.evidence.orderId);
  const deliveryId = clean(input.evidence.deliveryId);
  const courierId = clean(input.evidence.courierId);
  const buyerId = clean(input.evidence.buyerId);
  const confirmedAt = requireIso(input.evidence.confirmedAt, 'DELIVERY_CONFIRMED_AT');
  const createdAt = requireIso(obligation.createdAt, 'OBLIGATION_CREATED_AT');

  if (
    obligation.schemaVersion !== ECONOMIC_OBLIGATION_SCHEMA_VERSION ||
    obligation.kind !== 'courier_payable' ||
    obligation.beneficiaryType !== 'courier' ||
    obligation.beneficiaryPrincipalId !== courierId ||
    obligation.currency !== 'BRL' ||
    !Number.isSafeInteger(obligation.amountMinor) ||
    obligation.amountMinor <= 0 ||
    obligation.storeId !== storeId ||
    obligation.orderId !== orderId ||
    obligation.fulfillmentId !== deliveryId
  ) {
    throw new Error('ECONOMIC_OBLIGATION_ELIGIBILITY_COURIER_PAYABLE_MISMATCH');
  }
  if (obligation.status !== 'pending') {
    throw new Error(
      `ECONOMIC_OBLIGATION_ELIGIBILITY_STATUS_INVALID:${obligation.status}`
    );
  }
  if (obligation.eligibleAt || obligation.settledAt || obligation.reversedAt) {
    throw new Error('ECONOMIC_OBLIGATION_ELIGIBILITY_LIFECYCLE_CONFLICT');
  }
  if (!buyerId || !courierId || !deliveryId) {
    throw new Error('ECONOMIC_OBLIGATION_ELIGIBILITY_DELIVERY_ACTOR_REQUIRED');
  }
  if (Date.parse(confirmedAt) < Date.parse(createdAt)) {
    throw new Error('ECONOMIC_OBLIGATION_ELIGIBILITY_BEFORE_CREATION');
  }

  return {
    status: 'eligible',
    eligibleAt: confirmedAt,
    eligibility: {
      authority: DELIVERY_COMPLETION_ELIGIBILITY_AUTHORITY,
      reference: `delivery:${deliveryId}:buyer_confirmation`,
      buyerId,
      courierId,
      confirmedAt,
    },
  };
};
