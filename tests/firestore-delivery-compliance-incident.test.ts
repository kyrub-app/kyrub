import assert from 'node:assert/strict';
import test from 'node:test';
import { Timestamp } from 'firebase-admin/firestore';
import { adminDb } from '../server/firebaseAdmin';
import { resolveDeliveryComplianceIncident } from '../server/delivery/deliveryComplianceIncidentService';

if (!process.env.FIRESTORE_EMULATOR_HOST) {
  throw new Error('DELIVERY_COMPLIANCE_TEST_REQUIRES_FIRESTORE_EMULATOR');
}
process.env.FIREBASE_PROJECT_ID = 'kyrub-security-test';
process.env.GCLOUD_PROJECT = 'kyrub-security-test';

const operatorId = 'compliance_incident_test';
const courierId = 'courier_incident_test';
const storeId = 'store_incident_test';
const orderId = 'order_incident_test';
const now = Timestamp.now();

const seed = async (deliveryId: string, status: 'accepted' | 'delivering') => {
  const collected = status === 'delivering';
  await Promise.all([
    adminDb.doc(`kyrub_admin/control_plane/admins/${operatorId}`).set({
      uid: operatorId, role: 'operations', status: 'active',
    }),
    adminDb.doc(`courierComplianceHolds/${courierId}`).set({
      userId: courierId, active: true, decision: 'revoked', eventId: 'review_evt_test',
    }),
    adminDb.doc(`deliveryComplianceIncidents/${deliveryId}`).set({
      deliveryId, courierId, storeId, status: 'awaiting_logistics_review',
      source: 'motofrete_qualification_revoked', eventId: 'review_evt_test',
      deliveryStatusAtReview: status,
    }),
    adminDb.doc(`hub/renda/deliveries/${deliveryId}`).set({
      id: deliveryId, source: 'kyrub-order', sourceOrderId: orderId, storeId,
      acceptedBy: courierId, acceptedByName: 'Entregador de Teste', status,
      vehicleType: 'motorcycle', acceptedAt: now, pickupHandoff: {
        status: collected ? 'handed_over' : 'awaiting_code',
      }, ...(collected ? { collectedAt: now } : {}),
    }),
    adminDb.doc(`deliveryClaims/${deliveryId}`).set({
      courierId, vehicleType: 'motorcycle', status,
      ...(collected ? { collectedAt: now } : {}),
    }),
    adminDb.doc(`hub/renda/deliveryOffers/${deliveryId}`).set({
      id: deliveryId, status,
    }),
    adminDb.doc(`deliveryTracking/${deliveryId}`).set({
      deliveryId, courierId, active: true, latitude: -23.5,
      longitude: -46.6, accuracy: 11, storeArrivalEvidence: {kind: 'courier_inside_store_geofence'},
    }),
    adminDb.doc(`deliveryPickupSecrets/${deliveryId}`).set({
      deliveryId, code: '739201', attempts: 0,
    }),
    adminDb.doc(`deliveryEscalationQueue/${deliveryId}`).set({
      id: deliveryId, status: 'cancelled', cancelledReason: 'accepted_by_kyrub', acceptedBy: courierId,
    }),
    adminDb.doc(`artifacts/${storeId}/public/data/customerOrders/${orderId}`).set({
      fulfillmentType: 'delivery', deliveryProvider: 'kyrub',
      status: collected ? 'out_for_delivery' : 'ready',
    }),
  ]);
};

test('admin releases only pre-pickup job atomically, invalidates code/GPS/old claim and leaves immutable audit', async () => {
  const id = 'incident_emulator_release';
  await seed(id, 'accepted');
  const input = {
    deliveryId: id, operatorId,
    decision: 'release_for_new_acceptance' as const,
    reason: 'Pedido ainda na loja, liberar para novo aceite.',
  };
  const result = await resolveDeliveryComplianceIncident(input);
  const replay = await resolveDeliveryComplianceIncident(input);
  assert.equal(replay.eventId, result.eventId);
  const [delivery, claim, offer, tracking, secret, incident, schedule, hold, audit] = await Promise.all([
    adminDb.doc(`hub/renda/deliveries/${id}`).get(),
    adminDb.doc(`deliveryClaims/${id}`).get(),
    adminDb.doc(`hub/renda/deliveryOffers/${id}`).get(),
    adminDb.doc(`deliveryTracking/${id}`).get(),
    adminDb.doc(`deliveryPickupSecrets/${id}`).get(),
    adminDb.doc(`deliveryComplianceIncidents/${id}`).get(),
    adminDb.doc(`deliveryEscalationQueue/${id}`).get(),
    adminDb.doc(`courierComplianceHolds/${courierId}`).get(),
    adminDb.collection('deliveryComplianceIncidentEvents').where('deliveryId', '==', id).get(),
  ]);
  assert.equal(delivery.data()?.status, 'available');
  assert.equal(delivery.data()?.acceptedBy, '');
  assert.equal(delivery.data()?.vehicleType, undefined);
  assert.equal(delivery.data()?.pickupHandoff, undefined);
  assert.equal(claim.exists, false);
  assert.equal(offer.data()?.status, 'available');
  assert.equal(secret.exists, false);
  assert.equal(tracking.data()?.active, false);
  assert.equal(tracking.data()?.latitude, undefined);
  assert.equal(tracking.data()?.storeArrivalEvidence, undefined);
  assert.equal(schedule.data()?.status, 'waiting');
  assert.equal(schedule.data()?.acceptedBy, undefined);
  assert.equal(hold.data()?.active, true);
  assert.equal(incident.data()?.status, 'released_for_new_acceptance');
  assert.equal(audit.size, 1);
  assert.equal(audit.docs[0].data().operatorId, operatorId);
});

test('collected parcel cannot be reopened; supervised handoff preserves assignment, and buyer confirmation closes incident', async () => {
  const id = 'incident_emulator_in_transit';
  await seed(id, 'delivering');
  const base = { deliveryId: id, operatorId, reason: 'Pacote já retirado, preservar custódia e acompanhar o suporte.' };
  await assert.rejects(
    resolveDeliveryComplianceIncident({ ...base, decision: 'release_for_new_acceptance' }),
    /INCIDENT_CONFLICT/
  );
  await resolveDeliveryComplianceIncident({ ...base, decision: 'request_supervised_handoff' });
  const [during, claim, code, tracking] = await Promise.all([
    adminDb.doc(`hub/renda/deliveries/${id}`).get(),
    adminDb.doc(`deliveryClaims/${id}`).get(),
    adminDb.doc(`deliveryPickupSecrets/${id}`).get(),
    adminDb.doc(`deliveryTracking/${id}`).get(),
  ]);
  assert.equal(during.data()?.status, 'delivering');
  assert.equal(claim.data()?.courierId, courierId);
  assert.equal(code.exists, true);
  assert.equal(tracking.data()?.active, true);
  await assert.rejects(
    resolveDeliveryComplianceIncident({
      deliveryId: id, operatorId, decision: 'close_after_buyer_confirmation',
      reason: 'Ainda sem confirmação real do comprador.',
    }),
    /INCIDENT_CONFLICT/
  );

  // Represents the existing buyer-confirmation transaction, never an admin
  // endpoint: only confirmed settlement can make this incident closable.
  await Promise.all([
    adminDb.doc(`hub/renda/deliveries/${id}`).update({status: 'done'}),
    adminDb.doc(`deliveryClaims/${id}`).update({status: 'done'}),
    adminDb.doc(`deliveryCompletions/${id}`).set({
      status: 'confirmed', settlementEligible: true, confirmedBy: 'buyer_test',
    }),
  ]);
  const ended = await resolveDeliveryComplianceIncident({
    deliveryId: id, operatorId,
    decision: 'close_after_buyer_confirmation',
    reason: 'Comprador confirmou recebimento, incidente pode ser encerrado.',
  });
  assert.ok(ended.eventId);
  const incident = await adminDb.doc(`deliveryComplianceIncidents/${id}`).get();
  const events = await adminDb.collection('deliveryComplianceIncidentEvents')
    .where('deliveryId', '==', id).get();
  assert.equal(incident.data()?.status, 'closed_after_buyer_confirmation');
  assert.equal(events.size, 2);
  assert.equal((await adminDb.doc(`deliveryClaims/${id}`).get()).data()?.courierId, courierId);
});
