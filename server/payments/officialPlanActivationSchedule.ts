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
  buyerStoreActivatedAt: string | null;
  months: 1 | 3 | 6 | 12;
}): OfficialPlanActivationSchedule {
  const paidAt = new Date(input.paidAt);
  if (!Number.isFinite(paidAt.getTime())) throw Error('OFFICIAL_PLAN_INVALID_PAYMENT_DATE');
  if (![1, 3, 6, 12].includes(input.months)) throw Error('OFFICIAL_PLAN_INVALID_TERM');
  const iso = paidAt.toISOString();
  // A legacy Free record or an incomplete store profile is not proof of activation.
  // The caller must provide an authoritative activation timestamp.
  const activatedAt = input.buyerStoreActivatedAt === null ? NaN : Date.parse(input.buyerStoreActivatedAt);
  if (input.buyerStoreActivatedAt !== null && !Number.isFinite(activatedAt)) {
    throw Error('OFFICIAL_PLAN_INVALID_STORE_ACTIVATION_DATE');
  }
  return Number.isFinite(activatedAt) && activatedAt <= paidAt.getTime()
    ? { state: 'active', paidAt: iso, startsAt: iso, expiresAt: addMonthsUtc(iso, input.months) }
    : { state: 'paid_pending_activation', paidAt: iso, startsAt: null, expiresAt: null };
}

/**
 * Launch rule: a verified Pix payment starts the purchased term immediately,
 * regardless of whether the buyer has created or published a store.
 * This pure helper does not grant access before provider confirmation.
 */
export function scheduleOfficialPlanFromConfirmedPayment(input: {
  paidAt: string;
  months: 1 | 3 | 6 | 12;
}): OfficialPlanActivationSchedule {
  const timestamp = new Date(input.paidAt);
  if (!Number.isFinite(timestamp.getTime())) throw Error('OFFICIAL_PLAN_INVALID_PAYMENT_DATE');
  if (![1, 3, 6, 12].includes(input.months)) throw Error('OFFICIAL_PLAN_INVALID_TERM');
  const startsAt = timestamp.toISOString();
  return {
    state: 'active',
    paidAt: startsAt,
    startsAt,
    expiresAt: addMonthsUtc(startsAt, input.months),
  };
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

/**
 * Provider retries must never downgrade an already confirmed payment to
 * 'bound'. A pending paid contract remains pending until store activation.
 */
export function officialPixStatusAfterProviderBind(
  current: string
): 'activated' | 'paid_pending_activation' | 'bound' {
  if (current === 'activated') return 'activated';
  if (current === 'paid_pending_activation') return 'paid_pending_activation';
  return 'bound';
}

/**
 * Resolve buyer-store identity without treating legacy Free registration as
 * store activation. An ambiguous or orphaned canonical identity fails closed.
 */
export function resolveOfficialPlanBuyerStore(input: {
  canonicalStoreIds: string[];
  hasLegacyStore: boolean;
}): { buyerStoreId: string | null; buyerStoreProvisioningRequired: boolean } {
  if (input.canonicalStoreIds.length > 1 ||
      (input.canonicalStoreIds.length === 1 && !input.hasLegacyStore)) {
    throw Error('OFFICIAL_PIX_BUYER_STORE_IDENTITY_CONFLICT');
  }
  if (input.canonicalStoreIds.length === 1) {
    const id = input.canonicalStoreIds[0];
    if (!id || !/^[a-zA-Z0-9_-]{1,128}$/.test(id)) {
      throw Error('OFFICIAL_PIX_BUYER_STORE_IDENTITY_CONFLICT');
    }
    return { buyerStoreId: id, buyerStoreProvisioningRequired: false };
  }
  return { buyerStoreId: null, buyerStoreProvisioningRequired: true };
}

/**
 * Financial recognition and access entitlement are separate effects.
 * Payment may be recorded immediately, but benefits and plan mirrors must
 * wait until the canonical store has actually been activated.
 */
export function officialPlanPaymentEffects(
  schedule: OfficialPlanActivationSchedule
): {
  recordPayment: true;
  grantEntitlement: boolean;
  writePlanMirrors: boolean;
  reconcileBenefitCycle: boolean;
  checkoutStatus: 'paid_pending_activation' | 'activated';
} {
  const active = schedule.state === 'active';
  if (active && (!schedule.startsAt || !schedule.expiresAt)) {
    throw Error('OFFICIAL_PLAN_INVALID_ACTIVE_TERM');
  }
  if (!active && (schedule.startsAt !== null || schedule.expiresAt !== null)) {
    throw Error('OFFICIAL_PLAN_INVALID_PENDING_TERM');
  }
  return {
    recordPayment: true,
    grantEntitlement: active,
    writePlanMirrors: active,
    reconcileBenefitCycle: active,
    checkoutStatus: active ? 'activated' : 'paid_pending_activation',
  };
}
