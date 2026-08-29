import {
  ECONOMIC_OBLIGATION_SCHEMA_VERSION,
  type EconomicObligation,
} from './economicObligations.js';

export const PICKUP_HANDOFF_ELIGIBILITY_AUTHORITY =
  'pickup_handoff_handed_over' as const;

export interface PickupHandoffEligibilityEvidence {
  storeId: string;
  orderId: string;
  verifiedAt: string;
  verifiedBy: string;
  handedOverAt: string;
  handedOverBy: string;
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

  // A future post-paid flow may create the economic obligation after the
  // physical handoff. In that case eligibility starts when the obligation
  // itself exists, while preserving the earlier handoff evidence.
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
