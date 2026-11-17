import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { buildDeliveryReturnEconomicPreview } from '../shared/deliveryReturnEconomicPolicy';

const base = {
  deliveryId: 'delivery-1', orderId: 'order-1', courierId: 'courier-1',
  receivedCondition: 'intact' as const, sourceCaptureId: 'capture-1',
  originalRouteMinor: 1200, existingCourierObligations: [] as Array<{id:string;status:string}>,
};

test('return economics v1 separates original route, return, waiting and buyer refund', () => {
  const preview = buildDeliveryReturnEconomicPreview(base);
  assert.equal(preview.policyVersion, 1);
  assert.deepEqual(preview.segments.map(row => row.kind),
    ['original_route','authorized_return','additional_waiting','buyer_refund']);
  assert.equal(preview.segments[0].amountMinor, 1200);
  assert.deepEqual(preview.segments.slice(1).map(row=>row.amountMinor), [null,null,null]);
  assert.equal(preview.totalRecognizedMinor, null);
  assert.equal(preview.contractGraceMinutes, null);
  assert.equal(preview.settlementStatus, 'blocked_pending_independent_reconciliation');
  assert.equal(new Set(preview.segments.map(row => row.id)).size, 4);
  assert.ok(preview.segments.every(row => row.fundingResponsibility === 'pending_human_classification'));
});

test('unavailable capture, zero value, disputed return and existing payable do not create a new payment', () => {
  const missing = buildDeliveryReturnEconomicPreview({...base, sourceCaptureId:null, originalRouteMinor:null});
  assert.equal(missing.segments[0].status, 'authority_unavailable');
  assert.equal(missing.segments[0].amountMinor, null);
  const zero = buildDeliveryReturnEconomicPreview({...base, originalRouteMinor:0});
  assert.equal(zero.segments[0].status, 'captured_zero_requires_review');
  const dispute = buildDeliveryReturnEconomicPreview({...base,receivedCondition:'damaged',
    existingCourierObligations:[{id:'paid-1',status:'settled'},{id:'wait-1',status:'pending'}]});
  assert.equal(dispute.duplicateOrIneligibleObligation,true);
  assert.deepEqual(dispute.pendingObligationIds,['wait-1']);
  assert.equal(dispute.segments[1].amountMinor, null);
  assert.equal(dispute.refundStatus,'requires_separate_consumer_rights_review');
  assert.throws(()=>buildDeliveryReturnEconomicPreview({...base,originalRouteMinor:-1}),
    /DELIVERY_RETURN_ECONOMICS_INVALID/);
  assert.throws(()=>buildDeliveryReturnEconomicPreview({...base,originalRouteMinor:0.5}),
    /DELIVERY_RETURN_ECONOMICS_INVALID/);
  assert.throws(()=>buildDeliveryReturnEconomicPreview({...base,
    existingCourierObligations:[{id:'x',status:'pending'},{id:'x',status:'pending'}]}),
    /DELIVERY_RETURN_ECONOMICS_INVALID/);
});

test('return financial preflight reads server authority only and has no financial write', () => {
  const service = readFileSync('server/delivery/deliveryReturnEconomicReviewService.ts','utf8');
  const router = readFileSync('server/delivery/deliveryOpportunityRouter.ts','utf8');
  const ui = readFileSync('src/components/admin/AdminDeliveryReturnEconomicsPreview.tsx','utf8');
  const queue = readFileSync('src/components/admin/AdminDeliverySupportQueue.tsx','utf8');
  assert.match(service,/deliveryReturnProtocols/);
  assert.match(service,/receivedByStoreAt/);
  assert.match(service,/economicLedger/);
  assert.match(service,/payment_capture/);
  assert.match(service,/buildCourierPayableObligationFromCapture/);
  assert.match(service,/economicObligations/);
  assert.doesNotMatch(service,/\.create\(/);
  assert.doesNotMatch(service,/\.update\(/);
  assert.doesNotMatch(service,/\.set\(/);
  assert.match(router,/\/admin\/returns\/:deliveryId\/economic-preflight/);
  assert.match(queue,/AdminDeliveryReturnEconomicsPreview/);
  assert.match(ui,/Total final não apurado/);
});
