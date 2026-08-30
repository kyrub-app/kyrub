import type {
  DeliveryOperationalEvent,
  DeliveryOperationalResponsibilityPolicySnapshot,
  DeliveryResponsibilityInterval,
} from './deliveryOperationalResponsibility.js';

export type DeliveryResponsibilityAssessmentStatus =
  | 'billable_store_waiting'
  | 'billable_customer_waiting'
  | 'courier_delay'
  | 'external_delay'
  | 'review_required'
  | 'no_billable_delay';

export interface DeliveryResponsibilityAssessment {
  schemaVersion: 1;
  deliveryId: string;
  status: DeliveryResponsibilityAssessmentStatus;
  intervals: DeliveryResponsibilityInterval[];
  billableStoreWaitingSeconds: number;
  billableCustomerWaitingSeconds: number;
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

const interval = (input: {
  startsAt: string;
  endsAt: string;
  responsibleActor: DeliveryResponsibilityInterval['responsibleActor'];
  reasonCode: DeliveryResponsibilityInterval['reasonCode'];
  confidence: DeliveryResponsibilityInterval['confidence'];
  evidenceEventIds: string[];
  economicallyBillable: boolean;
}): DeliveryResponsibilityInterval | null => {
  const start = millis(input.startsAt);
  const end = millis(input.endsAt);
  if (start === null || end === null || end < start) return null;
  return {
    ...input,
    durationSeconds: Math.floor((end - start) / 1000),
  };
};

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
  let billableStoreWaitingSeconds = 0;
  let billableCustomerWaitingSeconds = 0;

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
        if (readyMs === null || readyMs > freeEndsMs) {
          const storeResponsibleEndMs = readyMs === null ? pickupMs : Math.min(readyMs, pickupMs);
          if (storeResponsibleEndMs > freeEndsMs) {
            const candidate = interval({
              startsAt: new Date(freeEndsMs).toISOString(),
              endsAt: new Date(storeResponsibleEndMs).toISOString(),
              responsibleActor: 'store',
              reasonCode: 'store_not_ready_after_free_window',
              confidence: readyMs === null ? 'low' : 'high',
              evidenceEventIds: [storeArrival.id, ...(storeReady ? [storeReady.id] : []), pickup.id],
              economicallyBillable: readyMs !== null,
            });
            if (candidate) {
              intervals.push(candidate);
              if (candidate.economicallyBillable) billableStoreWaitingSeconds += candidate.durationSeconds;
            }
          }
        }
        if (readyMs !== null && pickupMs > Math.max(readyMs, freeEndsMs)) {
          const courierStartMs = Math.max(readyMs, freeEndsMs);
          const candidate = interval({
            startsAt: new Date(courierStartMs).toISOString(),
            endsAt: pickup.occurredAt,
            responsibleActor: 'courier',
            reasonCode: 'courier_delayed_pickup_after_ready',
            confidence: 'high',
            evidenceEventIds: [storeReady!.id, pickup.id],
            economicallyBillable: false,
          });
          if (candidate?.durationSeconds) intervals.push(candidate);
        }
      }
    }
  }

  const customerArrival = eventOf(relevant, 'courier_arrived_customer');
  const customerAvailable = eventOf(relevant, 'customer_available');
  const confirmed = eventOf(relevant, 'delivery_confirmed');
  if (customerArrival && confirmed) {
    const arrivalMs = millis(customerArrival.occurredAt);
    const confirmedMs = millis(confirmed.occurredAt);
    const availableMs = customerAvailable ? millis(customerAvailable.occurredAt) : null;
    if (arrivalMs !== null && confirmedMs !== null && confirmedMs >= arrivalMs) {
      const freeEndsMs = arrivalMs + input.policy.customerFreeWaitingSeconds * 1000;
      if (confirmedMs > freeEndsMs && availableMs !== null && availableMs > freeEndsMs) {
        const customerResponsibleEndMs = Math.min(availableMs, confirmedMs);
        const candidate = interval({
          startsAt: new Date(freeEndsMs).toISOString(),
          endsAt: new Date(customerResponsibleEndMs).toISOString(),
          responsibleActor: 'customer',
          reasonCode: 'customer_not_available_after_free_window',
          confidence: 'high',
          evidenceEventIds: [customerArrival.id, customerAvailable!.id, confirmed.id],
          economicallyBillable: true,
        });
        if (candidate) {
          intervals.push(candidate);
          billableCustomerWaitingSeconds += candidate.durationSeconds;
        }
      }
    }
  }

  const incident = eventOf(relevant, 'incident_reported');
  let status: DeliveryResponsibilityAssessmentStatus = 'no_billable_delay';
  if (incident) status = 'external_delay';
  else if (billableStoreWaitingSeconds > 0) status = 'billable_store_waiting';
  else if (billableCustomerWaitingSeconds > 0) status = 'billable_customer_waiting';
  else if (intervals.some(item => item.responsibleActor === 'courier')) status = 'courier_delay';
  else if ((storeArrival && !pickup) || (customerArrival && !confirmed)) status = 'review_required';

  return {
    schemaVersion: 1,
    deliveryId,
    status,
    intervals,
    billableStoreWaitingSeconds,
    billableCustomerWaitingSeconds,
    assessedAt: input.assessedAt,
    policyId: input.policy.policyId,
    policyVersion: input.policy.version,
    authority: 'kyrub_operational_responsibility_engine',
  };
};
