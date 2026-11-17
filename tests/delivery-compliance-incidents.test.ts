import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import {
  assessIncidentDisposition,
  type IncidentState,
} from '../server/delivery/deliveryComplianceIncidentService';

const accepted = (): IncidentState => ({
  incidentStatus: 'awaiting_logistics_review',
  incidentSource: 'motofrete_qualification_revoked',
  courierId: 'courier-a',
  assignedCourierId: 'courier-a',
  claimCourierId: 'courier-a',
  claimStatus: 'accepted',
  deliverySource: 'kyrub-order',
  deliveryStatus: 'accepted',
  vehicleType: 'motorcycle',
  orderStatus: 'ready',
  orderProvider: 'kyrub',
  fulfillmentType: 'delivery',
  hasPickupEvidence: false,
  hasCompletion: false,
  holdActive: true,
});

test('only a not-yet-collected Kyrub order may be released for a new courier acceptance', () => {
  assert.equal(assessIncidentDisposition(accepted(), 'release_for_new_acceptance').allowed, true);
  const denied: Array<Partial<IncidentState>> = [
    { incidentStatus: 'released_for_new_acceptance' },
    { incidentSource: 'other_issue' },
    { courierId: 'somebody-else' },
    { assignedCourierId: 'somebody-else' },
    { claimCourierId: 'somebody-else' },
    { claimStatus: 'delivering' },
    { deliverySource: 'manual' },
    { deliveryStatus: 'delivering' },
    { vehicleType: 'car' },
    { orderStatus: 'out_for_delivery' },
    { orderStatus: 'completed' },
    { orderProvider: 'store' },
    { fulfillmentType: 'pickup' },
    { hasPickupEvidence: true },
    { hasCompletion: true },
    { holdActive: false },
  ];
  for (const overrides of denied) {
    assert.equal(assessIncidentDisposition({...accepted(),...overrides}, 'release_for_new_acceptance').allowed,
      false, JSON.stringify(overrides));
  }
});

test('already collected parcel is handled by logistics, not silently re-offered', () => {
  const delivering = {
    ...accepted(),
    claimStatus: 'delivering',
    deliveryStatus: 'delivering',
    hasPickupEvidence: true,
  };
  assert.equal(assessIncidentDisposition(delivering, 'release_for_new_acceptance').allowed, false);
  assert.equal(assessIncidentDisposition(delivering, 'request_supervised_handoff').allowed, true);
  assert.equal(assessIncidentDisposition({...delivering,hasPickupEvidence:false}, 'request_supervised_handoff').allowed, false);
  assert.equal(assessIncidentDisposition({...accepted(),hasPickupEvidence:false}, 'request_supervised_handoff').allowed, false);
  assert.equal(assessIncidentDisposition(delivering, 'close_after_buyer_confirmation').allowed, false);
});

test('incident may be closed only after actual buyer confirmation, including supervised handoff', () => {
  const done = {
    ...accepted(),
    incidentStatus: 'awaiting_supervised_handoff',
    claimStatus: 'done',
    deliveryStatus: 'done',
    hasPickupEvidence: true,
    hasCompletion: true,
  };
  assert.equal(assessIncidentDisposition(done, 'close_after_buyer_confirmation').allowed, true);
  assert.equal(assessIncidentDisposition({...done,hasCompletion:false}, 'close_after_buyer_confirmation').allowed, false);
  assert.equal(assessIncidentDisposition({...done,deliveryStatus:'delivering'}, 'close_after_buyer_confirmation').allowed, false);
  assert.equal(assessIncidentDisposition({...done,claimStatus:'delivering'}, 'close_after_buyer_confirmation').allowed, false);
  assert.equal(assessIncidentDisposition({...done,incidentStatus:'closed_after_buyer_confirmation'}, 'close_after_buyer_confirmation').allowed, false);
});

test('administrative release is a single atomic cleanup with a server-only incident audit', () => {
  const source = readFileSync('server/delivery/deliveryComplianceIncidentService.ts','utf8');
  const router = readFileSync('server/delivery/deliveryOpportunityRouter.ts','utf8');
  const ui = readFileSync('src/components/admin/AdminDeliveryComplianceIncidents.tsx','utf8');
  const rules = readFileSync('firestore.identity-verification.fragment.rules','utf8');

  assert.match(source,/adminDb\.runTransaction/);
  assert.match(source,/operator\.status !== 'active'/);
  assert.match(source,/transaction\.create\(eventRef/);
  assert.match(source,/transaction\.delete\(claimRef/);
  assert.match(source,/transaction\.update\(deliveryRef/);
  assert.match(source,/transaction\.update\(offerRef/);
  assert.match(source,/transaction\.delete\(secretRef/);
  assert.match(source,/transaction\.update\(trackingRef/);
  assert.match(source,/transaction\.set\(scheduleRef/);
  assert.match(source,/pickupConfirmedOperationalEventId/);
  assert.match(source,/completionSnapshot\.exists/);
  assert.match(source,/holdSnapshot\.data\(\)\?\.active === true/);
  assert.doesNotMatch(source,/transaction\.update\(completionRef/);
  assert.doesNotMatch(source,/transaction\.delete\(completionRef/);
  assert.match(router,/router\.post\('\/admin\/compliance-incidents\/:deliveryId\/resolve'/);
  assert.match(ui,/AdminDeliveryComplianceIncidents/);
  assert.match(ui,/Solicitar transferência supervisionada/);
  assert.match(ui,/Encerrar após confirmação do comprador/);
  assert.match(rules,/match \/deliveryComplianceIncidentEvents\/\{eventId\}/);
  assert.match(rules,/allow create, update, delete: if false/);
});
