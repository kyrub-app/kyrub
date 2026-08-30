export const DELIVERY_OPERATIONAL_RESPONSIBILITY_SCHEMA_VERSION = 1 as const;

export type DeliveryOperationalActor =
  | 'store'
  | 'courier'
  | 'customer'
  | 'external'
  | 'undetermined';

export type DeliveryOperationalEventType =
  | 'courier_accepted'
  | 'courier_entered_store_geofence'
  | 'store_marked_ready'
  | 'courier_pickup_attempted'
  | 'pickup_confirmed'
  | 'courier_left_store'
  | 'customer_approach_notification_sent'
  | 'customer_near_notification_sent'
  | 'courier_entered_customer_geofence'
  | 'courier_arrived_customer'
  | 'customer_available'
  | 'delivery_confirmed'
  | 'incident_reported';

export type DeliveryOperationalEventAuthority =
  | 'server'
  | 'geofence'
  | 'store_action'
  | 'courier_action'
  | 'customer_action'
  | 'notification_provider';

export interface DeliveryOperationalEvent {
  schemaVersion: 1;
  id: string;
  deliveryId: string;
  orderId: string;
  storeId: string;
  courierId: string;
  type: DeliveryOperationalEventType;
  occurredAt: string;
  recordedAt: string;
  authority: DeliveryOperationalEventAuthority;
  actor?: DeliveryOperationalActor;
  referenceId?: string;
}

export interface DeliveryOperationalResponsibilityPolicySnapshot {
  policyId: string;
  version: number;
  enabled: boolean;
  storeFreeWaitingSeconds: number;
  customerFreeWaitingSeconds: number;
  snapshottedAt: string;
  authority: 'kyrub_platform';
}

export interface DeliveryOperationalEtaSnapshot {
  expectedTravelToStoreSeconds: number;
  expectedTravelToCustomerSeconds: number;
  calculatedAt: string;
  authority: 'routing_provider';
  routingReferenceId: string;
}

export type DeliveryResponsibilityReasonCode =
  | 'store_not_ready_after_free_window'
  | 'courier_delayed_pickup_after_ready'
  | 'customer_not_available_after_free_window'
  | 'courier_delayed_handoff_after_arrival'
  | 'traffic_or_route_delay'
  | 'incident_or_accident'
  | 'location_evidence_conflict'
  | 'insufficient_evidence';

export type DeliveryResponsibilityEvidenceStatus =
  | 'authoritative'
  | 'corroborated'
  | 'review_required';

export interface DeliveryResponsibilityInterval {
  startsAt: string;
  endsAt: string;
  durationSeconds: number;
  responsibleActor: DeliveryOperationalActor;
  reasonCode: DeliveryResponsibilityReasonCode;
  evidenceStatus: DeliveryResponsibilityEvidenceStatus;
  evidenceEventIds: string[];
}

const clean = (value: string): string => value.trim();

const nonNegativeSafeInteger = (value: number, label: string): number => {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new Error(`DELIVERY_RESPONSIBILITY_${label}_INVALID`);
  }
  return value;
};

export const buildDeliveryOperationalResponsibilityPolicySnapshot = (input: {
  policyId: string;
  version: number;
  enabled: boolean;
  storeFreeWaitingSeconds: number;
  customerFreeWaitingSeconds: number;
  snapshottedAt: string;
}): DeliveryOperationalResponsibilityPolicySnapshot => {
  const policyId = clean(input.policyId);
  const snapshottedAt = clean(input.snapshottedAt);
  if (!policyId || !snapshottedAt || !Number.isSafeInteger(input.version) || input.version <= 0) {
    throw new Error('DELIVERY_RESPONSIBILITY_POLICY_IDENTITY_INVALID');
  }

  return {
    policyId,
    version: input.version,
    enabled: input.enabled === true,
    storeFreeWaitingSeconds: nonNegativeSafeInteger(input.storeFreeWaitingSeconds, 'STORE_FREE_WAITING'),
    customerFreeWaitingSeconds: nonNegativeSafeInteger(input.customerFreeWaitingSeconds, 'CUSTOMER_FREE_WAITING'),
    snapshottedAt,
    authority: 'kyrub_platform',
  };
};
