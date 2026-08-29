import {
  canTransitionEconomicObligationStatus,
  type EconomicObligation,
} from './economicObligations.js';

const clean = (value: unknown): string =>
  typeof value === 'string' ? value.trim() : '';

const requireIso = (value: unknown, label: string): string => {
  const normalized = clean(value);
  if (!normalized || !Number.isFinite(Date.parse(normalized))) {
    throw new Error(`ECONOMIC_OBLIGATION_${label}_INVALID`);
  }
  return normalized;
};

export const reverseEconomicObligationBeforeSettlement = (input: {
  obligation: EconomicObligation;
  occurredAt: string;
}): EconomicObligation => {
  const occurredAt = requireIso(input.occurredAt, 'REVERSAL_TIME');
  const createdAt = requireIso(input.obligation.createdAt, 'CREATED_TIME');

  if (Date.parse(occurredAt) < Date.parse(createdAt)) {
    throw new Error('ECONOMIC_OBLIGATION_REVERSAL_BEFORE_CREATION');
  }

  if (input.obligation.status === 'reversed') {
    return input.obligation;
  }

  if (!canTransitionEconomicObligationStatus(input.obligation.status, 'reversed')) {
    throw new Error('ECONOMIC_OBLIGATION_REVERSAL_REQUIRES_COMPENSATION');
  }

  if (input.obligation.eligibleAt) {
    const eligibleAt = requireIso(input.obligation.eligibleAt, 'ELIGIBLE_TIME');
    if (Date.parse(occurredAt) < Date.parse(eligibleAt)) {
      throw new Error('ECONOMIC_OBLIGATION_REVERSAL_BEFORE_ELIGIBILITY');
    }
  }

  if (input.obligation.settledAt) {
    throw new Error('ECONOMIC_OBLIGATION_REVERSAL_REQUIRES_COMPENSATION');
  }

  return {
    ...input.obligation,
    status: 'reversed',
    reversedAt: occurredAt,
  };
};
