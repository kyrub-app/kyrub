import { adminDb } from '../firebaseAdmin.js';
import {
  buildDeliveryCustomerArrivalPolicySnapshot,
  type DeliveryCustomerArrivalPolicySnapshot,
} from '../../shared/deliveryCustomerArrivalPolicy.js';

export const DELIVERY_CUSTOMER_ARRIVAL_POLICY_PATH =
  'platformOperationalPolicies/deliveryCustomerArrival';

const record = (value: unknown): Record<string, unknown> =>
  value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};

const clean = (value: unknown): string =>
  typeof value === 'string' ? value.trim() : '';

export const parseAuthoritativeDeliveryCustomerArrivalPolicy = (
  value: unknown,
  snapshottedAt: string
): DeliveryCustomerArrivalPolicySnapshot | null => {
  const raw = record(value);
  if (
    raw.enabled !== true ||
    !clean(raw.policyId) ||
    !Number.isSafeInteger(raw.version) || Number(raw.version) <= 0 ||
    !Number.isSafeInteger(raw.radiusMeters) || Number(raw.radiusMeters) <= 0
  ) return null;

  return buildDeliveryCustomerArrivalPolicySnapshot({
    policyId: clean(raw.policyId),
    version: Number(raw.version),
    radiusMeters: Number(raw.radiusMeters),
    snapshottedAt,
  });
};

export const loadAuthoritativeDeliveryCustomerArrivalPolicy = async (
  snapshottedAt: string
): Promise<DeliveryCustomerArrivalPolicySnapshot | null> => {
  const snapshot = await adminDb.doc(DELIVERY_CUSTOMER_ARRIVAL_POLICY_PATH).get();
  if (!snapshot.exists) return null;
  return parseAuthoritativeDeliveryCustomerArrivalPolicy(
    snapshot.data(),
    snapshottedAt
  );
};
