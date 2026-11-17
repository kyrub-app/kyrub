import { FieldValue, Timestamp } from 'firebase-admin/firestore';
import { adminDb } from '../firebaseAdmin.js';
import { pickupConfirmedOperationalEventId } from './deliveryPickupHandoffService.js';

const DELIVERY_COLLECTION = 'hub/renda/deliveries';
const CLAIM_COLLECTION = 'deliveryClaims';
const OFFER_COLLECTION = 'hub/renda/deliveryOffers';
const TRACKING_COLLECTION = 'deliveryTracking';
const SECRET_COLLECTION = 'deliveryPickupSecrets';
const INCIDENT_COLLECTION = 'deliveryComplianceIncidents';
const INCIDENT_EVENTS = 'deliveryComplianceIncidentEvents';
const SCHEDULE_COLLECTION = 'deliveryEscalationQueue';
const COMPLETIONS_COLLECTION = 'deliveryCompletions';
const ESCALATION_DELAY_MS = 3 * 60 * 1000;

export type IncidentDisposition =
  | 'release_for_new_acceptance'
  | 'request_supervised_handoff'
  | 'close_after_buyer_confirmation';

const clean = (value: unknown): string => typeof value === 'string' ? value.trim() : '';
const record = (value: unknown): Record<string, unknown> =>
  value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};

const safeId = (value: string): string => {
  if (!/^[a-zA-Z0-9_-]{1,128}$/.test(value)) throw new Error('INCIDENT_INVALID');
  return value;
};

export interface IncidentState {
  incidentStatus: string;
  incidentSource: string;
  courierId: string;
  assignedCourierId: string;
  claimCourierId: string;
  claimStatus: string;
  deliverySource: string;
  deliveryStatus: string;
  vehicleType: string;
  orderStatus: string;
  orderProvider: string;
  fulfillmentType: string;
  hasPickupEvidence: boolean;
  hasCompletion: boolean;
  holdActive: boolean;
}

export const assessIncidentDisposition = (
  state: IncidentState,
  decision: IncidentDisposition
): { allowed: boolean; reason: string } => {
  const conflict = (reason: string) => ({ allowed: false, reason });
  if (!['awaiting_logistics_review','awaiting_supervised_handoff'].includes(state.incidentStatus)
    || (state.incidentStatus === 'awaiting_supervised_handoff'
      && decision !== 'close_after_buyer_confirmation')
    || state.incidentSource !== 'motofrete_qualification_revoked'
    || state.vehicleType !== 'motorcycle'
    || !state.holdActive
    || !state.courierId
    || state.courierId !== state.assignedCourierId
    || state.courierId !== state.claimCourierId
    || state.deliverySource !== 'kyrub-order') {
    return conflict('O incidente, entregador ou bloqueio mudou. Atualize a fila.');
  }
  if (decision === 'release_for_new_acceptance') {
    return state.deliveryStatus === 'accepted'
      && state.claimStatus === 'accepted'
      && !state.hasPickupEvidence
      && !state.hasCompletion
      && state.orderProvider === 'kyrub'
      && state.fulfillmentType === 'delivery'
      && ['preparing','ready'].includes(state.orderStatus)
        ? { allowed: true, reason: '' }
        : conflict('Só é possível liberar nova atribuição antes da coleta segura, com pedido ainda na loja.');
  }
  if (decision === 'request_supervised_handoff') {
    return state.deliveryStatus === 'delivering'
      && state.claimStatus === 'delivering'
      && state.hasPickupEvidence
      && !state.hasCompletion
        ? { allowed: true, reason: '' }
        : conflict('A transferência supervisionada exige pacote já coletado e entrega em rota.');
  }
  if (decision === 'close_after_buyer_confirmation') {
    return state.deliveryStatus === 'done'
      && state.claimStatus === 'done'
      && state.hasCompletion
        ? { allowed: true, reason: '' }
        : conflict('Somente a confirmação efetiva do comprador permite encerrar este incidente.');
  }
  return conflict('Decisão inválida.');
};

export interface ResolveComplianceIncidentInput {
  deliveryId: string;
  operatorId: string;
  decision: IncidentDisposition;
  reason: string;
}

export const resolveDeliveryComplianceIncident = async (
  input: ResolveComplianceIncidentInput
): Promise<{ deliveryId: string; decision: IncidentDisposition; eventId: string }> => {
  const deliveryId = safeId(input.deliveryId);
  const operatorId = safeId(input.operatorId);
  const reason = input.reason.trim();
  if (!['release_for_new_acceptance','request_supervised_handoff','close_after_buyer_confirmation'].includes(input.decision)
    || reason.length < 10 || reason.length > 500) {
    throw new Error('INCIDENT_INVALID');
  }
  const operatorRef = adminDb.doc(`kyrub_admin/control_plane/admins/${operatorId}`);
  const incidentRef = adminDb.doc(`${INCIDENT_COLLECTION}/${deliveryId}`);
  const deliveryRef = adminDb.doc(`${DELIVERY_COLLECTION}/${deliveryId}`);
  const claimRef = adminDb.doc(`${CLAIM_COLLECTION}/${deliveryId}`);
  const offerRef = adminDb.doc(`${OFFER_COLLECTION}/${deliveryId}`);
  const trackingRef = adminDb.doc(`${TRACKING_COLLECTION}/${deliveryId}`);
  const secretRef = adminDb.doc(`${SECRET_COLLECTION}/${deliveryId}`);
  const scheduleRef = adminDb.doc(`${SCHEDULE_COLLECTION}/${deliveryId}`);
  const completionRef = adminDb.doc(`${COMPLETIONS_COLLECTION}/${deliveryId}`);
  const pickupEventRef = adminDb.doc(`deliveryOperationalEvents/${pickupConfirmedOperationalEventId(deliveryId)}`);
  const eventRef = adminDb.collection(INCIDENT_EVENTS).doc();

  return adminDb.runTransaction(async transaction => {
    const [operatorSnapshot, incidentSnapshot, deliverySnapshot, claimSnapshot,
      offerSnapshot, trackingSnapshot, secretSnapshot, scheduleSnapshot,
      completionSnapshot, pickupEventSnapshot] = await Promise.all([
      transaction.get(operatorRef),
      transaction.get(incidentRef),
      transaction.get(deliveryRef),
      transaction.get(claimRef),
      transaction.get(offerRef),
      transaction.get(trackingRef),
      transaction.get(secretRef),
      transaction.get(scheduleRef),
      transaction.get(completionRef),
      transaction.get(pickupEventRef),
    ]);
    const operator = record(operatorSnapshot.data());
    if (!operatorSnapshot.exists || operator.status !== 'active'
      || operator.uid !== operatorId
      || !['super_admin','operations','compliance'].includes(clean(operator.role))) {
      throw new Error('INCIDENT_FORBIDDEN');
    }
    const incident = record(incidentSnapshot.data());
    if (!incidentSnapshot.exists || clean(incident.deliveryId) !== deliveryId) {
      throw new Error('INCIDENT_CONFLICT');
    }
    if (incident.status !== 'awaiting_logistics_review'
      && !(incident.status === 'awaiting_supervised_handoff'
        && input.decision === 'close_after_buyer_confirmation')) {
      if (incident.decision === input.decision
        && incident.resolvedBy === operatorId && incident.reason === reason
        && clean(incident.resolutionEventId)) {
        return { deliveryId, decision: input.decision, eventId: clean(incident.resolutionEventId) };
      }
      throw new Error('INCIDENT_CONFLICT');
    }
    const delivery = record(deliverySnapshot.data());
    const claim = record(claimSnapshot.data());
    const courierId = clean(incident.courierId);
    if (!deliverySnapshot.exists || !claimSnapshot.exists
      || !offerSnapshot.exists || !courierId) throw new Error('INCIDENT_CONFLICT');
    const storeId = safeId(clean(delivery.storeId));
    const sourceOrderId = safeId(clean(delivery.sourceOrderId));
    const holdRef = adminDb.doc(`courierComplianceHolds/${courierId}`);
    const orderRef = adminDb.doc(`artifacts/${storeId}/public/data/customerOrders/${sourceOrderId}`);
    const [holdSnapshot, orderSnapshot] = await Promise.all([
      transaction.get(holdRef), transaction.get(orderRef),
    ]);
    const order = record(orderSnapshot.data());
    const hasPickupEvidence = Boolean(delivery.collectedAt || claim.collectedAt
      || pickupEventSnapshot.exists || record(delivery.pickupHandoff).status === 'handed_over'
      || record(claim.pickupHandoff).status === 'handed_over');
    const assessment = assessIncidentDisposition({
      incidentStatus: clean(incident.status),
      incidentSource: clean(incident.source),
      courierId,
      assignedCourierId: clean(delivery.acceptedBy),
      claimCourierId: clean(claim.courierId),
      claimStatus: clean(claim.status),
      deliverySource: clean(delivery.source),
      deliveryStatus: clean(delivery.status),
      vehicleType: clean(delivery.vehicleType),
      orderStatus: clean(order.status),
      orderProvider: clean(order.deliveryProvider),
      fulfillmentType: clean(order.fulfillmentType),
      hasPickupEvidence,
      hasCompletion: completionSnapshot.exists && completionSnapshot.data()?.status === 'confirmed'
        && completionSnapshot.data()?.settlementEligible === true,
      holdActive: holdSnapshot.data()?.active === true
        && clean(holdSnapshot.data()?.userId) === courierId,
    }, input.decision);
    if (!assessment.allowed) throw new Error('INCIDENT_CONFLICT:' + assessment.reason);

    const at = Timestamp.now();
    transaction.create(eventRef, {
      schemaVersion: 1,
      deliveryId,
      incidentId: deliveryId,
      incidentEventId: clean(incident.eventId),
      courierId,
      storeId,
      operatorId,
      decision: input.decision,
      deliveryStatusAtDecision: clean(delivery.status),
      reason,
      createdAt: at,
    });
    transaction.update(incidentRef, {
      status: input.decision === 'release_for_new_acceptance'
        ? 'released_for_new_acceptance'
        : input.decision === 'request_supervised_handoff'
          ? 'awaiting_supervised_handoff' : 'closed_after_buyer_confirmation',
      decision: input.decision,
      reason,
      resolvedBy: operatorId,
      resolvedAt: at,
      resolutionEventId: eventRef.id,
      updatedAt: at,
    });

    if (input.decision === 'release_for_new_acceptance') {
      // No pickup ever occurred. Preserve original audit and financial ledgers,
      // but release the claim atomically for an explicit new courier acceptance.
      transaction.delete(claimRef);
      transaction.update(deliveryRef, {
        status: 'available',
        acceptedBy: '',
        acceptedByName: '',
        vehicleType: FieldValue.delete(),
        acceptedAt: FieldValue.delete(),
        fallbackStatus: 'waiting_kyrub',
        pickupHandoff: FieldValue.delete(),
        availableAt: at,
        escalationAt: Timestamp.fromMillis(at.toMillis() + ESCALATION_DELAY_MS),
        updatedAt: at,
      });
      transaction.update(offerRef, { status: 'available', updatedAt: at });
      if (secretSnapshot.exists) transaction.delete(secretRef); // invalidate the previous pickup code
      if (trackingSnapshot.exists) {
        transaction.update(trackingRef, {
          active: false,
          latitude: FieldValue.delete(),
          longitude: FieldValue.delete(),
          accuracy: FieldValue.delete(),
          heading: FieldValue.delete(),
          speed: FieldValue.delete(),
          clientCapturedAt: FieldValue.delete(),
          storeArrivalEvidence: FieldValue.delete(),
          customerArrivalEvidence: FieldValue.delete(),
          storeArrivalAssessment: FieldValue.delete(),
          customerArrivalAssessment: FieldValue.delete(),
          endedAt: at,
          updatedAt: at,
        });
      }
      transaction.set(scheduleRef, {
        id: deliveryId,
        deliveryJobId: deliveryId,
        sourceOrderId,
        storeId,
        status: 'waiting',
        availableAt: Timestamp.fromMillis(at.toMillis() + ESCALATION_DELAY_MS),
        updatedAt: at,
        cancelledReason: FieldValue.delete(),
        acceptedBy: FieldValue.delete(),
        ...(scheduleSnapshot.exists ? {} : { createdAt: at }),
      }, { merge: true });
    }
    // A parcel in transit is NOT reassigned by updating the Firestore claimant.
    // It needs a witnessed physical handoff; the buyer's existing confirmation
    // remains the only path to done and economic settlement.
    return { deliveryId, decision: input.decision, eventId: eventRef.id };
  });
};
