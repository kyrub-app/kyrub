import { addMonthsUtc } from './prepaidSubscriptionContractLifecycle.js';

export type OfficialPlanActivationState = 'paid_pending_activation' | 'active';

export interface OfficialPlanActivationSchedule {
  state: OfficialPlanActivationState;
  paidAt: string;
  startsAt: string | null;
  expiresAt: string | null;
}

/**
 * A paid subscription must not consume its purchased term while the buyer
 * has not activated a store. This pure decision is shared by the payment
 * reconciliation and the store activation path; neither may infer an
 * activation date from the original payment timestamp.
 */
export function scheduleOfficialPlanAfterPayment(input: {
  paidAt: string;
  buyerStoreActivated: boolean;
  months: 1 | 3 | 6 | 12;
}): OfficialPlanActivationSchedule {
  const paidAt = new Date(input.paidAt);
  if (!Number.isFinite(paidAt.getTime())) throw Error('OFFICIAL_PLAN_INVALID_PAYMENT_DATE');
  if (![1, 3, 6, 12].includes(input.months)) throw Error('OFFICIAL_PLAN_INVALID_TERM');
  const iso = paidAt.toISOString();
  return input.buyerStoreActivated
    ? { state: 'active', paidAt: iso, startsAt: iso, expiresAt: addMonthsUtc(iso, input.months) }
    : { state: 'paid_pending_activation', paidAt: iso, startsAt: null, expiresAt: null };
}

export function activatePaidOfficialPlan(input: {
  schedule: OfficialPlanActivationSchedule;
  activatedAt: string;
  months: 1 | 3 | 6 | 12;
}): OfficialPlanActivationSchedule {
  if (input.schedule.state === 'active') {
    if (!input.schedule.startsAt || !input.schedule.expiresAt) throw Error('OFFICIAL_PLAN_INVALID_ACTIVE_TERM');
    return input.schedule; // idempotent: a retry cannot reset the paid term
  }
  if (input.schedule.state !== 'paid_pending_activation' ||
      input.schedule.startsAt !== null || input.schedule.expiresAt !== null) {
    throw Error('OFFICIAL_PLAN_INVALID_PENDING_TERM');
  }
  const activatedAt = new Date(input.activatedAt);
  if (!Number.isFinite(activatedAt.getTime()) || activatedAt.getTime() < Date.parse(input.schedule.paidAt)) {
    throw Error('OFFICIAL_PLAN_INVALID_ACTIVATION_DATE');
  }
  if (![1, 3, 6, 12].includes(input.months)) throw Error('OFFICIAL_PLAN_INVALID_TERM');
  const startsAt = activatedAt.toISOString();
  return { ...input.schedule, state: 'active', startsAt, expiresAt: addMonthsUtc(startsAt, input.months) };
}
