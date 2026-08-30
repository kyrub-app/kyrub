import type {
  DeliveryOperationalEvent,
  DeliveryOperationalResponsibilityPolicySnapshot,
  DeliveryResponsibilityInterval,
} from './deliveryOperationalResponsibility.js';

export type DeliveryResponsibilityAssessmentStatus =
  | 'attributed'
  | 'external'
  | 'review_required'
  | 'no_attributable_delay';

export interface DeliveryResponsibilityAssessment {
  schemaVersion: 1;
  deliveryId: string;
  status: DeliveryResponsibilityAssessmentStatus;
  intervals: DeliveryResponsibilityInterval[];
  assessedAt: string;
  policyId: string;
  policyVersion: number;
  authority: 'kyrub_operational_responsibility_engine';
}

const millis = (value: string): number | null => {
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : null;
};

const eventOf = (
  events: DeliveryOperationalEvent[],
  type: DeliveryOperationalEvent['type']
): DeliveryOperationalEvent | null => events.find(event => event.type === type) ?? null;

const interval = (input: Omit<DeliveryResponsibilityInterval, 'durationSeconds'>): DeliveryResponsibilityInterval | null => {
  const start = millis(input.startsAt);
  const end = millis(input.endsAt);
  if (start === null || end === null || end < start) return null;
  return { ...input, durationSeconds: Math.floor((end - start) / 1000) };
};

const customerArrivalIsAuthoritative = (event: DeliveryOperationalEvent): boolean =>
  event.type === 'courier_entered_customer_geofence' ||
  event.authority === 'geofence' ||
  event.authority === 'server';

export const assessDeliveryOperationalResponsibility = (input: {
  deliveryId: string;
  events: DeliveryOperationalEvent[];
  policy: DeliveryOperationalResponsibilityPolicySnapshot;
  assessedAt: string;
}): DeliveryResponsibilityAssessment => {
  const deliveryId = input.deliveryId.trim();
  if (!deliveryId || input.policy.enabled !== true || !input.policy.policyId.trim()) {
    throw new Error('DELIVERY_RESPONSIBILITY_ASSESSMENT_INPUT_INVALID');
  }

  const relevant = input.events.filter(event => event.deliveryId === deliveryId);
  const intervals: DeliveryResponsibilityInterval[] = [];

  const storeArrival = eventOf(relevant, 'courier_entered_store_geofence');
  const storeReady = eventOf(relevant, 'store_marked_ready');
  const pickup = eventOf(relevant, 'pickup_confirmed');

  if (storeArrival && pickup) {
    const arrivalMs = millis(storeArrival.occurredAt);
    const pickupMs = millis(pickup.occurredAt);
    const readyMs = storeReady ? millis(storeReady.occurredAt) : null;
    if (arrivalMs !== null && pickupMs !== null && pickupMs >= arrivalMs) {
      const freeEndsMs = arrivalMs + input.policy.storeFreeWaitingSeconds * 1000;
      if (pickupMs > freeEndsMs) {
        if (readyMs === null) {
          const candidate = interval({
            startsAt: new Date(freeEndsMs).toISOString(),
            endsAt: pickup.occurredAt,
            responsibleActor: 'undetermined',
            reasonCode: 'insufficient_evidence',
            evidenceStatus: 'review_required',
            evidenceEventIds: [storeArrival.id, pickup.id],
          });
          if (candidate?.durationSeconds) intervals.push(candidate);
        } else if (readyMs > freeEndsMs) {
          const storeEndMs = Math.min(readyMs, pickupMs);
          const candidate = interval({
            startsAt: new Date(freeEndsMs).toISOString(),
            endsAt: new Date(storeEndMs).toISOString(),
            responsibleActor: 'store',
            reasonCode: 'store_not_ready_after_free_window',
            evidenceStatus: 'corroborated',
            evidenceEventIds: [storeArrival.id, storeReady!.id, pickup.id],
          });
          if (candidate?.durationSeconds) intervals.push(candidate);
        }

        if (readyMs !== null && pickupMs > Math.max(readyMs, freeEndsMs)) {
          const courierStartMs = Math.max(readyMs, freeEndsMs);
          const candidate = interval({
            startsAt: new Date(courierStartMs).toISOString(),
            endsAt: pickup.occurredAt,
            responsibleActor: 'courier',
            reasonCode: 'courier_delayed_pickup_after_ready',
            evidenceStatus: 'corroborated',
            evidenceEventIds: [storeReady!.id, pickup.id],
          });
          if (candidate?.durationSeconds) intervals.push(candidate);
        }
      }
    }
  }

  const customerGeofenceArrival = eventOf(relevant, 'courier_entered_customer_geofence');
  const customerDeclaredArrival = eventOf(relevant, 'courier_arrived_customer');
  const customerArrival = customerGeofenceArrival ?? customerDeclaredArrival;
  const customerAvailable = eventOf(relevant, 'customer_available');
  const confirmed = eventOf(relevant, 'delivery_confirmed');

  if (customerArrival && confirmed) {
    const arrivalMs = millis(customerArrival.occurredAt);
    const confirmedMs = millis(confirmed.occurredAt);
    const availableMs = customerAvailable ? millis(customerAvailable.occurredAt) : null;
    if (arrivalMs !== null && confirmedMs !== null && confirmedMs >= arrivalMs) {
      const freeEndsMs = arrivalMs + input.policy.customerFreeWaitingSeconds * 1000;
      if (confirmedMs > freeEndsMs && availableMs !== null && availableMs > freeEndsMs) {
        const customerEndMs = Math.min(availableMs, confirmedMs);
        const authoritativeArrival = customerArrivalIsAuthoritative(customerArrival);
        const candidate = interval({
          startsAt: new Date(freeEndsMs).toISOString(),
          endsAt: new Date(customerEndMs).toISOString(),
          responsibleActor: authoritativeArrival ? 'customer' : 'undetermined',
          reasonCode: authoritativeArrival
            ? 'customer_not_available_after_free_window'
            : 'location_evidence_conflict',
          evidenceStatus: authoritativeArrival ? 'corroborated' : 'review_required',
          evidenceEventIds: [customerArrival.id, customerAvailable!.id, confirmed.id],
        });
        if (candidate?.durationSeconds) intervals.push(candidate);
      }
    }
  }

  const incident = eventOf(relevant, 'incident_reported');
  let status: DeliveryResponsibilityAssessmentStatus = 'no_attributable_delay';
  if (incident) status = 'external';
  else if (intervals.some(item => item.evidenceStatus === 'review_required')) status = 'review_required';
  else if (intervals.length > 0) status = 'attributed';
  else if ((storeArrival && !pickup) || (customerArrival && !confirmed)) status = 'review_required';

  return {
    schemaVersion: 1,
    deliveryId,
    status,
    intervals,
    assessedAt: input.assessedAt,
    policyId: input.policy.policyId,
    policyVersion: input.policy.version,
    authority: 'kyrub_operational_responsibility_engine',
  };
};
