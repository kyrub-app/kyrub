import assert from 'node:assert/strict';
import test from 'node:test';
import { Timestamp } from 'firebase-admin/firestore';
import { adminDb } from '../server/firebaseAdmin';
import {
  proposeSupervisedCustodyTransfer,
  acknowledgeSupervisedCustodyTransfer,
  attestSupervisedCustodyTransfer,
} from '../server/delivery/deliverySupervisedTransferService';
import {
  markCourierArrivedAtCustomer,
  confirmBuyerReceivedDelivery,
} from '../server/delivery/deliveryCustomerHandoffService';

if (!process.env.FIRESTORE_EMULATOR_HOST) {
  throw new Error('SUPERVISED_TRANSFER_TEST_REQUIRES_FIRESTORE_EMULATOR');
}
process.env.FIREBASE_PROJECT_ID = 'kyrub-security-test';
process.env.GCLOUD_PROJECT = 'kyrub-security-test';

const operatorId = 'supervisor_transfer_test';
const originalCourierId = 'original_transfer_test';
const recipientId = 'receiving_transfer_test';
const storeId = 'store_transfer_test';
const buyerId = 'buyer_transfer_test';
const orderId = 'order_transfer_test';

const seed = async (id: string) => {
  const at = Timestamp.now();
  await Promise.all([
    adminDb.doc(`kyrub_admin/control_plane/admins/${operatorId}`).set({
      uid: operatorId, role: 'operations', status: 'active',
    }),
    adminDb.doc(`identity_verifications/${recipientId}`).set({
      uid: recipientId, status: 'approved', approvedProfiles: ['bicycle_courier'],
    }),
    adminDb.doc(`courierComplianceHolds/${originalCourierId}`).set({
      userId: originalCourierId, active: true, decision: 'revoked',
    }),
    adminDb.doc(`deliveryComplianceIncidents/${id}`).set({
      deliveryId: id, source: 'motofrete_qualification_revoked',
      status: 'awaiting_supervised_handoff',
      courierId: originalCourierId, storeId,
    }),
    adminDb.doc(`hub/renda/deliveries/${id}`).set({
      id, source: 'kyrub-order', storeId, sourceOrderId: orderId,
      buyerId, acceptedBy: originalCourierId,
      status: 'delivering', vehicleType: 'motorcycle', collectedAt: at,
      cargo: {
        kind: 'parcel', weightKg: 3, lengthCm: 30,
        widthCm: 20, heightCm: 12, requiresSpecialHandling: false,
      },
    }),
    adminDb.doc(`deliveryClaims/${id}`).set({
      deliveryJobId: id, courierId: originalCourierId,
      status: 'delivering', vehicleType: 'motorcycle', collectedAt: at,
    }),
    adminDb.doc(`deliveryTracking/${id}`).set({
      deliveryId: id, courierId: originalCourierId, active: true,
      latitude: -23.55, longitude: -46.65, accuracy: 9,
      updatedAt: at,
    }),
    adminDb.doc(`artifacts/${storeId}/public/data/customerOrders/${orderId}`).set({
      buyerId, fulfillmentType: 'delivery', deliveryProvider: 'kyrub',
      status: 'out_for_delivery',
    }),
  ]);
};

test('signed declarations and supervisor attestation are independent, idempotent and cannot alter the original claim', async () => {
  const id = 'supervised_transfer_e2e';
  await seed(id);
  const payload = {
    deliveryId: id, operatorId, toCourierId: recipientId,
    targetVehicle: 'bicycle', reason: 'Responsável impedido e suporte presencial acordado.',
  };
  await assert.rejects(
    proposeSupervisedCustodyTransfer({ ...payload, toCourierId: originalCourierId }),
    /CUSTODY_TRANSFER_INVALID/
  );
  const proposed = await proposeSupervisedCustodyTransfer(payload);
  assert.equal(proposed.status, 'awaiting_participant_confirmations');
  assert.equal((await proposeSupervisedCustodyTransfer(payload)).status, 'awaiting_participant_confirmations');
  await assert.rejects(
    acknowledgeSupervisedCustodyTransfer({
      deliveryId: id, actorId: 'other_user', statement: 'physically_received',
    }), /CUSTODY_TRANSFER_FORBIDDEN/
  );
  await assert.rejects(
    acknowledgeSupervisedCustodyTransfer({
      deliveryId: id, actorId: originalCourierId, statement: 'physically_received',
    }), /CUSTODY_TRANSFER_INVALID/
  );
  await assert.rejects(
    attestSupervisedCustodyTransfer({
      deliveryId: id, supervisorId: operatorId,
      note: 'Ainda sem a confirmação de ambos os participantes.',
    }), /CUSTODY_TRANSFER_EXPIRED_OR_CONFLICT/
  );
  const source = await acknowledgeSupervisedCustodyTransfer({
    deliveryId: id, actorId: originalCourierId, statement: 'physically_handed_over',
  });
  assert.equal(source.status, 'awaiting_participant_confirmations');
  assert.equal((await acknowledgeSupervisedCustodyTransfer({
    deliveryId: id, actorId: originalCourierId, statement: 'physically_handed_over',
  })).status, 'awaiting_participant_confirmations');

  // A declared change of physical custody must NOT create courier payable
  // or permit the original driver to certify arrival or buyer delivery.
  await assert.rejects(markCourierArrivedAtCustomer({
    deliveryId: id, courierId: originalCourierId,
  }), /CUSTODY_TRANSFER_SETTLEMENT_HOLD/);
  await assert.rejects(confirmBuyerReceivedDelivery({
    deliveryId: id, buyerId,
  }), /CUSTODY_TRANSFER_SETTLEMENT_HOLD/);

  const recipient = await acknowledgeSupervisedCustodyTransfer({
    deliveryId: id, actorId: recipientId, statement: 'physically_received',
  });
  assert.equal(recipient.status, 'awaiting_supervisor_review');
  const reviewed = await attestSupervisedCustodyTransfer({
    deliveryId: id, supervisorId: operatorId,
    note: 'Entregadores confirmaram; assinatura supervisionada revisada.',
  });
  assert.equal(reviewed.status, 'evidence_recorded_pending_reconciliation');
  assert.equal((await attestSupervisedCustodyTransfer({
    deliveryId: id, supervisorId: operatorId,
    note: 'Entregadores confirmaram; assinatura supervisionada revisada.',
  })).status, reviewed.status);
  assert.equal((await acknowledgeSupervisedCustodyTransfer({
    deliveryId: id, actorId: originalCourierId, statement: 'physically_handed_over',
  })).status, reviewed.status);

  const [transfer, incident, delivery, claim, tracking, completion, events] = await Promise.all([
    adminDb.doc(`deliveryCustodyTransfers/${id}`).get(),
    adminDb.doc(`deliveryComplianceIncidents/${id}`).get(),
    adminDb.doc(`hub/renda/deliveries/${id}`).get(),
    adminDb.doc(`deliveryClaims/${id}`).get(),
    adminDb.doc(`deliveryTracking/${id}`).get(),
    adminDb.doc(`deliveryCompletions/${id}`).get(),
    adminDb.collection('deliveryCustodyTransferEvents').where('deliveryId', '==', id).get(),
  ]);
  assert.equal(transfer.data()?.status, 'evidence_recorded_pending_reconciliation');
  assert.equal(transfer.data()?.compensationStatus, 'reconciliation_required');
  assert.equal(incident.data()?.status, 'transfer_evidence_confirmed_pending_reconciliation');
  assert.equal(delivery.data()?.acceptedBy, originalCourierId);
  assert.equal(delivery.data()?.status, 'delivering');
  assert.equal(claim.data()?.courierId, originalCourierId);
  assert.equal(tracking.data()?.courierId, originalCourierId);
  assert.equal(completion.exists, false);
  assert.equal(events.size, 4);
});

test('expired or unqualified receiver cannot acknowledge physical custody', async () => {
  const id = 'supervised_transfer_expired';
  await seed(id);
  const payload = {
    deliveryId: id, operatorId, toCourierId: recipientId,
    targetVehicle: 'bicycle', reason: 'Nova pessoa revisada presencialmente pela logística.',
  };
  await proposeSupervisedCustodyTransfer(payload);
  await adminDb.doc(`deliveryCustodyTransfers/${id}`).update({
    expiresAt: Timestamp.fromMillis(Date.now() - 1),
  });
  await assert.rejects(acknowledgeSupervisedCustodyTransfer({
    deliveryId: id, actorId: recipientId, statement: 'physically_received',
  }), /CUSTODY_TRANSFER_EXPIRED_OR_CONFLICT/);
  await adminDb.doc(`deliveryCustodyTransfers/${id}`).update({
    expiresAt: Timestamp.fromMillis(Date.now() + 600_000),
  });
  await adminDb.doc(`identity_verifications/${recipientId}`).update({status: 'under_review'});
  await assert.rejects(acknowledgeSupervisedCustodyTransfer({
    deliveryId: id, actorId: recipientId, statement: 'physically_received',
  }), /CUSTODY_TRANSFER_CONFLICT/);
});
