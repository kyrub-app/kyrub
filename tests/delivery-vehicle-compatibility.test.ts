import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import {
  assessDeliveryCargo,
  courierVehicleDocumentEligibility,
  isCourierVehicleType,
} from '../shared/deliveryVehicleCompatibility';

const parcel = { kind: 'parcel', weightKg: 3, lengthCm: 35, widthCm: 24, heightCm: 20, requiresSpecialHandling: false };

test('food and objects require explicit seller-declared physical cargo data', () => {
  for (const value of [undefined, {}, {kind:'food'}, {...parcel, requiresSpecialHandling:true},
    {...parcel, weightKg:0}, {...parcel, lengthCm: NaN}]) {
    assert.equal(assessDeliveryCargo(value).ready, false);
    assert.deepEqual(assessDeliveryCargo(value).allowedVehicles, []);
  }
  assert.deepEqual(assessDeliveryCargo(parcel).allowedVehicles, ['bicycle', 'motorcycle', 'car']);
  assert.equal(assessDeliveryCargo({...parcel, kind:'food'}).cargo?.kind, 'food');
  assert.deepEqual(assessDeliveryCargo({...parcel, weightKg:13}).allowedVehicles, ['motorcycle', 'car']);
  assert.deepEqual(assessDeliveryCargo({...parcel, weightKg:45}).allowedVehicles, ['car']);
  assert.deepEqual(assessDeliveryCargo({...parcel, weightKg:180}).allowedVehicles, []);
  assert.deepEqual(assessDeliveryCargo({...parcel, lengthCm:55}).allowedVehicles, ['motorcycle','car']);
  assert.deepEqual(assessDeliveryCargo({...parcel, lengthCm:55, widthCm:53}).allowedVehicles, ['car']);
});

test('motorized registration is not automatic authorization for every vehicle', () => {
  const motorized = {
    status: 'approved', approvedProfiles:['motorized_courier'],
    documentPaths:['cnh'], cnhCategory:'A', cnhHasEar:true,
  };
  assert.equal(courierVehicleDocumentEligibility(motorized,'motorcycle').eligible, true);
  assert.equal(courierVehicleDocumentEligibility(motorized,'car').eligible, false);
  assert.equal(courierVehicleDocumentEligibility({...motorized,cnhCategory:'B'},'car').eligible, true);
  assert.equal(courierVehicleDocumentEligibility({...motorized,cnhCategory:'B'},'motorcycle').eligible, false);
  assert.equal(courierVehicleDocumentEligibility({...motorized,cnhCategory:'AB'},'motorcycle').eligible, true);
  assert.equal(courierVehicleDocumentEligibility({...motorized,cnhCategory:'AB'},'car').eligible, true);
  assert.equal(courierVehicleDocumentEligibility({...motorized,cnhHasEar:false},'motorcycle').eligible,false);
  assert.equal(courierVehicleDocumentEligibility({...motorized,documentPaths:[]},'motorcycle').eligible,false);
  assert.equal(courierVehicleDocumentEligibility({...motorized,status:'under_review'},'motorcycle').eligible,false);
  assert.equal(courierVehicleDocumentEligibility(motorized,'bicycle').eligible,false);
  assert.equal(courierVehicleDocumentEligibility({status:'approved',approvedProfiles:['bicycle_courier']},'bicycle').eligible,true);
  assert.equal(courierVehicleDocumentEligibility({
    status:'approved',approvedProfiles:['freelancer','motorized_courier'],
    documentType:'cin',documentPaths:['identity'],
    profileExpansion:{profile:'motorized_courier',status:'approved',cnhCategory:'AB',cnhHasEar:true,documentPaths:['cnh']},
  },'car').eligible,true);
  for (const value of ['bicycle','motorcycle','car']) assert.equal(isCourierVehicleType(value),true);
  assert.equal(isCourierVehicleType('van'),false);
});

test('the server—not the interface—must enforce the vehicle and cargo before the atomic claim', () => {
  const router = readFileSync('server/delivery/deliveryOpportunityRouter.ts','utf8');
  assert.match(router,/courierVehicleDocumentEligibility/);
  assert.match(router,/assessDeliveryCargo/);
  assert.match(router,/transaction\.get\(identityReference\)/);
  assert.match(router,/transaction\.create\(claimReference/);
  assert.match(router,/VEHICLE_NOT_ELIGIBLE|DELIVERY_CARGO_INCOMPLETE/);
  assert.match(router,/vehicleType: vehicle/);
  assert.match(router,/vehicleType: request\.body\?\.vehicleType/);
});
