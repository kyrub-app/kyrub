export interface DeliveryCustomerArrivalPolicySnapshot {
  policyId: string;
  version: number;
  enabled: true;
  radiusMeters: number;
  snapshottedAt: string;
  authority: 'kyrub_platform';
}

const clean = (value: unknown): string =>
  typeof value === 'string' ? value.trim() : '';

export const buildDeliveryCustomerArrivalPolicySnapshot = (input: {
  policyId: string;
  version: number;
  radiusMeters: number;
  snapshottedAt: string;
}): DeliveryCustomerArrivalPolicySnapshot => {
  const policyId = clean(input.policyId);
  const snapshottedAt = clean(input.snapshottedAt);
  if (
    !policyId ||
    !Number.isSafeInteger(input.version) || input.version <= 0 ||
    !Number.isSafeInteger(input.radiusMeters) || input.radiusMeters <= 0 ||
    !snapshottedAt || Number.isNaN(Date.parse(snapshottedAt))
  ) {
    throw new Error('DELIVERY_CUSTOMER_ARRIVAL_POLICY_INVALID');
  }
  return {
    policyId,
    version: input.version,
    enabled: true,
    radiusMeters: input.radiusMeters,
    snapshottedAt: new Date(snapshottedAt).toISOString(),
    authority: 'kyrub_platform',
  };
};
