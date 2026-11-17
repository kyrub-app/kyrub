import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import {
  assessSupervisedTransfer,
  SUPERVISED_TRANSFER_TTL_MS,
} from '../server/delivery/deliverySupervisedTransferService';

const sample = () => ({
  incidentStatus: 'awaiting_supervised_handoff',
  incidentSource: 'motofrete_qualification_revoked',
  deliveryStatus: 'delivering',
  claimStatus: 'delivering',
  deliverySource: 'kyrub-order',
  fromCourierId: 'courier-original',
  claimCourierId: 'courier-original',
  deliveryCourierId: 'courier-original',
  vehicleType: 'motorcycle',
  pickupConfirmed: true,
  completionExists: false,
  holdActive: true,
  toCourierId: 'courier-receiver',
  targetVehicle: 'bicycle' as const,
  targetIdentity: { status: 'approved', approvedProfiles: ['bicycle_courier'] },
  targetHoldActive: false,
  cargo: {
    kind: 'parcel', weightKg: 3, lengthCm: 30, widthCm: 20,
    heightCm: 12, requiresSpecialHandling: false,
  },
});

test('supervised custody nomination requires original pickup, revoked moto and an eligible substitute', () => {
  assert.equal(assessSupervisedTransfer(sample()).allowed, true);
  for (const change of [
    { incidentStatus: 'awaiting_logistics_review' },
    { incidentSource: 'other' },
    { deliveryStatus: 'accepted' },
    { claimStatus: 'accepted' },
    { deliverySource: 'manual' },
    { fromCourierId: 'courier-receiver' },
    { claimCourierId: 'wrong-courier' },
    { deliveryCourierId: 'wrong-courier' },
    { vehicleType: 'car' },
    { pickupConfirmed: false },
    { completionExists: true },
    { holdActive: false },
    { targetHoldActive: true },
    { targetIdentity: { status: 'submitted', approvedProfiles: ['bicycle_courier'] } },
    { targetIdentity: { status: 'approved', approvedProfiles: ['motorized_courier'] } },
    { cargo: null },
    { cargo: { ...sample().cargo, weightKg: 15 } },
  ]) {
    assert.equal(assessSupervisedTransfer({ ...sample(), ...change }).allowed,
      false, JSON.stringify(change));
  }
  assert.equal(SUPERVISED_TRANSFER_TTL_MS, 1_800_000);
});

test('real app routes to independent courier declarations, supervisor and immutable audit', () => {
  const router = readFileSync('server/delivery/deliveryOpportunityRouter.ts','utf8');
  const service = readFileSync('server/delivery/deliverySupervisedTransferService.ts','utf8');
  const admin = readFileSync('src/components/admin/AdminSupervisedTransferPanel.tsx','utf8');
  const courier = readFileSync('src/components/store/CourierSupervisedHandoffBridge.tsx','utf8');
  const app = readFileSync('src/App.tsx','utf8');
  const firestore = readFileSync('firestore.identity-verification.fragment.rules','utf8');
  const arrival = readFileSync('server/delivery/deliveryCustomerHandoffService.ts','utf8');
  const tracking = readFileSync('server/delivery/deliveryTrackingRouter.ts','utf8');
  assert.match(router, /router\.post\('\/admin\/compliance-incidents\/:deliveryId\/supervised-handoff'/);
  assert.match(router, /router\.post\('\/:deliveryId\/supervised-handoff\/acknowledge'/);
  assert.match(service, /transaction\.create\(eventRef/);
  assert.match(service, /transaction\.update\(incidentRef/);
  assert.match(service, /compensationStatus: 'reconciliation_required'/);
  assert.doesNotMatch(service, /transaction\.update\(claimRef/);
  assert.doesNotMatch(service, /transaction\.delete\(claimRef/);
  assert.match(admin, /Indicar substituto \(sem reatribuição\)/);
  assert.match(admin, /Revisar duas declarações/);
  assert.match(courier, /physically_handed_over/);
  assert.match(courier, /physically_received/);
  assert.match(courier, /onAuthStateChanged/);
  assert.match(courier, /Reabrir transferência supervisionada/);
  assert.match(app, /<CourierSupervisedHandoffBridge/);
  assert.match(firestore, /match \/deliveryCustodyTransfers\/\{deliveryId\}/);
  assert.match(firestore, /match \/deliveryCustodyTransferEvents\/\{eventId\}/);
  assert.match(arrival, /CUSTODY_TRANSFER_SETTLEMENT_HOLD/);
  assert.match(arrival, /COURIER_COMPLIANCE_HOLD/);
  assert.match(arrival, /deliveryComplianceIncidents/);
  assert.match(tracking, /custodyDisputed/);
  assert.match(tracking, /CUSTODY_TRANSFER_SETTLEMENT_HOLD/);
});

test('two statements alone do not release payout, buyer completion or operational takeover', () => {
  const service = readFileSync('server/delivery/deliverySupervisedTransferService.ts','utf8');
  const customer = readFileSync('server/delivery/deliveryCustomerHandoffService.ts','utf8');
  assert.match(service, /status: 'evidence_recorded_pending_reconciliation'/);
  assert.match(service, /operationalAssignment: 'original_claim_retained'/);
  assert.match(service, /compensationStatus: 'reconciliation_required'/);
  assert.match(customer, /custody\.fromConfirmedAt \|\| custody\.toConfirmedAt/);
  assert.match(customer, /throw new Error\('CUSTODY_TRANSFER_SETTLEMENT_HOLD'\)/);
  assert.doesNotMatch(service, /economicLedger|courierPayableRef|transaction\.create\(completionRef/);
});
