import { adminDb } from '../firebaseAdmin';
import type { DeliveryPaidWaitingPolicySnapshot } from '../../shared/deliveryPaidWaiting.js';

export const DELIVERY_PAID_WAITING_POLICY_PATH =
  'platformEconomicPolicies/deliveryPaidWaiting';

const record = (value: unknown): Record<string, unknown> =>
  value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};

const clean = (value: unknown): string =>
  typeof value === 'string' ? value.trim() : '';

const nonNegativeSafeInteger = (value: unknown): number | null =>
  Number.isSafeInteger(value) && Number(value) >= 0 ? Number(value) : null;

const positiveSafeInteger = (value: unknown): number | null =>
  Number.isSafeInteger(value) && Number(value) > 0 ? Number(value) : null;

export const parseAuthoritativeDeliveryPaidWaitingPolicy = (
  value: unknown
): DeliveryPaidWaitingPolicySnapshot | null => {
  const raw = record(value);
  const policyId = clean(raw.policyId);
  const version = positiveSafeInteger(raw.version);
  const freeMinutes = nonNegativeSafeInteger(raw.freeMinutes);
  const billingIncrementMinutes = positiveSafeInteger(raw.billingIncrementMinutes);
  const amountPerIncrementMinor = positiveSafeInteger(raw.amountPerIncrementMinor);
  const maxAmountMinor = nonNegativeSafeInteger(raw.maxAmountMinor);
  const payer = raw.payer === 'store' || raw.payer === 'kyrub' ? raw.payer : null;

  if (
    raw.enabled !== true ||
    !policyId ||
    version === null ||
    freeMinutes === null ||
    billingIncrementMinutes === null ||
    amountPerIncrementMinor === null ||
    maxAmountMinor === null ||
    payer === null
  ) {
    return null;
  }

  return {
    policyId,
    version,
    enabled: true,
    freeMinutes,
    billingIncrementMinutes,
    amountPerIncrementMinor,
    maxAmountMinor,
    payer,
  };
};

export const loadAuthoritativeDeliveryPaidWaitingPolicy = async (): Promise<
  DeliveryPaidWaitingPolicySnapshot | null
> => {
  const snapshot = await adminDb.doc(DELIVERY_PAID_WAITING_POLICY_PATH).get();
  if (!snapshot.exists) return null;
  return parseAuthoritativeDeliveryPaidWaitingPolicy(snapshot.data());
};
