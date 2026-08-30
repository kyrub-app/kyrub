import type { EconomicObligation, EconomicObligationStatus } from './economicObligations.js';

export type EconomicFundingResponsibilityPayer = 'store' | 'kyrub';

export interface EconomicFundingResponsibilityProjection {
  obligationId: string;
  storeId: string;
  orderId: string;
  fulfillmentId: string;
  beneficiaryPrincipalId: string;
  sourceAuthority: 'delivery_paid_waiting';
  payer: EconomicFundingResponsibilityPayer;
  payerPrincipalId: string;
  currency: 'BRL';
  amountMinor: number;
  obligationStatus: EconomicObligationStatus;
  createdAt: string;
  eligibleAt: string;
  settledAt: string;
  reversedAt: string;
}

export interface EconomicFundingResponsibilityTotals {
  currency: 'BRL';
  pendingMinor: number;
  eligibleMinor: number;
  settledObligationMinor: number;
  reversedMinor: number;
  entryCount: number;
}

type FundingAwareObligation = EconomicObligation & {
  payer?: unknown;
  payerPrincipalId?: unknown;
  waitingEvidenceRef?: unknown;
  policyId?: unknown;
  policyVersion?: unknown;
};

const clean = (value: unknown): string =>
  typeof value === 'string' ? value.trim() : '';

const validIso = (value: string): boolean =>
  Boolean(value) && Number.isFinite(Date.parse(value));

const validIdentity = (value: string): boolean =>
  Boolean(value) && value.length <= 240 && !value.includes('/');

const addSafe = (left: number, right: number): number => {
  const total = left + right;
  if (!Number.isSafeInteger(total)) {
    throw new Error('ECONOMIC_FUNDING_RESPONSIBILITY_TOTAL_OVERFLOW');
  }
  return total;
};

const lifecycleIsConsistent = (obligation: EconomicObligation): boolean => {
  if (!validIso(obligation.createdAt)) return false;
  const createdAt = Date.parse(obligation.createdAt);
  if (obligation.status === 'pending') {
    return !obligation.eligibleAt && !obligation.settledAt && !obligation.reversedAt;
  }
  if (obligation.status === 'eligible') {
    return validIso(obligation.eligibleAt) &&
      Date.parse(obligation.eligibleAt) >= createdAt &&
      !obligation.settledAt &&
      !obligation.reversedAt;
  }
  if (obligation.status === 'settled') {
    return validIso(obligation.eligibleAt) &&
      validIso(obligation.settledAt) &&
      Date.parse(obligation.eligibleAt) >= createdAt &&
      Date.parse(obligation.settledAt) >= Date.parse(obligation.eligibleAt) &&
      !obligation.reversedAt;
  }
  if (!validIso(obligation.reversedAt) || obligation.settledAt) return false;
  if (Date.parse(obligation.reversedAt) < createdAt) return false;
  if (!obligation.eligibleAt) return true;
  return validIso(obligation.eligibleAt) &&
    Date.parse(obligation.eligibleAt) >= createdAt &&
    Date.parse(obligation.reversedAt) >= Date.parse(obligation.eligibleAt);
};

export const deriveEconomicFundingResponsibilityProjection = (
  obligationInput: EconomicObligation
): EconomicFundingResponsibilityProjection | null => {
  if (obligationInput.sourceAuthority !== 'delivery_paid_waiting') return null;
  const obligation = obligationInput as FundingAwareObligation;
  const payer = obligation.payer;
  const payerPrincipalId = clean(obligation.payerPrincipalId);
  const storeId = clean(obligation.storeId);
  const orderId = clean(obligation.orderId);
  const fulfillmentId = clean(obligation.fulfillmentId);
  const beneficiaryPrincipalId = clean(obligation.beneficiaryPrincipalId);
  const waitingEvidenceRef = clean(obligation.waitingEvidenceRef);
  const policyId = clean(obligation.policyId);
  const expectedPayerPrincipalId = payer === 'store'
    ? `store:${storeId}`
    : payer === 'kyrub'
      ? 'kyrub:platform'
      : '';

  if (
    obligation.schemaVersion !== 1 ||
    obligation.kind !== 'courier_payable' ||
    obligation.beneficiaryType !== 'courier' ||
    obligation.currency !== 'BRL' ||
    !Number.isSafeInteger(obligation.amountMinor) ||
    obligation.amountMinor <= 0 ||
    !validIdentity(storeId) ||
    !validIdentity(orderId) ||
    !validIdentity(fulfillmentId) ||
    !validIdentity(beneficiaryPrincipalId) ||
    (payer !== 'store' && payer !== 'kyrub') ||
    payerPrincipalId !== expectedPayerPrincipalId ||
    obligation.paymentId !== '' ||
    obligation.sourceEconomicEntryId !== '' ||
    waitingEvidenceRef !== `delivery:${fulfillmentId}:paidWaitingEvidence` ||
    !validIdentity(policyId) ||
    !Number.isSafeInteger(obligation.policyVersion) ||
    Number(obligation.policyVersion) <= 0 ||
    !lifecycleIsConsistent(obligation)
  ) {
    throw new Error('ECONOMIC_FUNDING_RESPONSIBILITY_WAITING_OBLIGATION_INVALID');
  }

  return {
    obligationId: obligation.id,
    storeId,
    orderId,
    fulfillmentId,
    beneficiaryPrincipalId,
    sourceAuthority: 'delivery_paid_waiting',
    payer,
    payerPrincipalId,
    currency: 'BRL',
    amountMinor: obligation.amountMinor,
    obligationStatus: obligation.status,
    createdAt: obligation.createdAt,
    eligibleAt: obligation.eligibleAt,
    settledAt: obligation.settledAt,
    reversedAt: obligation.reversedAt,
  };
};

export const deriveEconomicFundingResponsibilityProjections = (
  obligations: readonly EconomicObligation[]
): EconomicFundingResponsibilityProjection[] =>
  obligations.flatMap(obligation => {
    const projection = deriveEconomicFundingResponsibilityProjection(obligation);
    return projection ? [projection] : [];
  });

export const deriveEconomicFundingResponsibilityTotals = (
  projections: readonly EconomicFundingResponsibilityProjection[]
): EconomicFundingResponsibilityTotals => {
  let pendingMinor = 0;
  let eligibleMinor = 0;
  let settledObligationMinor = 0;
  let reversedMinor = 0;
  for (const projection of projections) {
    if (projection.obligationStatus === 'pending') {
      pendingMinor = addSafe(pendingMinor, projection.amountMinor);
    } else if (projection.obligationStatus === 'eligible') {
      eligibleMinor = addSafe(eligibleMinor, projection.amountMinor);
    } else if (projection.obligationStatus === 'settled') {
      settledObligationMinor = addSafe(settledObligationMinor, projection.amountMinor);
    } else {
      reversedMinor = addSafe(reversedMinor, projection.amountMinor);
    }
  }
  return {
    currency: 'BRL',
    pendingMinor,
    eligibleMinor,
    settledObligationMinor,
    reversedMinor,
    entryCount: projections.length,
  };
};
