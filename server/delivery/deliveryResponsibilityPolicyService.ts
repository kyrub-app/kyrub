import { adminDb } from '../firebaseAdmin.js';
import {
  buildDeliveryOperationalResponsibilityPolicySnapshot,
  type DeliveryOperationalResponsibilityPolicySnapshot,
} from '../../shared/deliveryOperationalResponsibility.js';

export const DELIVERY_RESPONSIBILITY_POLICY_PATH =
  'platformEconomicPolicies/deliveryOperationalResponsibility';

const record = (value: unknown): Record<string, unknown> =>
  value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};

const clean = (value: unknown): string =>
  typeof value === 'string' ? value.trim() : '';

export const parseAuthoritativeDeliveryResponsibilityPolicy = (
  value: unknown,
  snapshottedAt: string
): DeliveryOperationalResponsibilityPolicySnapshot | null => {
  const raw = record(value);
  if (
    raw.enabled !== true ||
    !clean(raw.policyId) ||
    !Number.isSafeInteger(raw.version) || Number(raw.version) <= 0 ||
    !Number.isSafeInteger(raw.storeFreeWaitingSeconds) || Number(raw.storeFreeWaitingSeconds) < 0 ||
    !Number.isSafeInteger(raw.customerFreeWaitingSeconds) || Number(raw.customerFreeWaitingSeconds) < 0
  ) return null;

  return buildDeliveryOperationalResponsibilityPolicySnapshot({
    policyId: clean(raw.policyId),
    version: Number(raw.version),
    enabled: true,
    storeFreeWaitingSeconds: Number(raw.storeFreeWaitingSeconds),
    customerFreeWaitingSeconds: Number(raw.customerFreeWaitingSeconds),
    snapshottedAt,
  });
};

export const loadAuthoritativeDeliveryResponsibilityPolicy = async (
  snapshottedAt: string
): Promise<DeliveryOperationalResponsibilityPolicySnapshot | null> => {
  const snapshot = await adminDb.doc(DELIVERY_RESPONSIBILITY_POLICY_PATH).get();
  if (!snapshot.exists) return null;
  return parseAuthoritativeDeliveryResponsibilityPolicy(snapshot.data(), snapshottedAt);
};
