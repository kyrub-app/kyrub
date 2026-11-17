import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import {
  validateCourierRemunerationSplit,
} from '../server/delivery/deliveryFinancialReconciliationService';

test('two-courier remuneration shares are bounded integer cent values with exact conservation', () => {
  assert.deepEqual(validateCourierRemunerationSplit(1299, 500, 799), {
    amountMinor:1299, outgoingMinor:500, incomingMinor:799,
  });
  assert.equal(validateCourierRemunerationSplit(1299, 0, 1299).incomingMinor, 1299);
  for (const [total,a,b] of [
    [1299,500,800], [1299,-1,1300], [1299,1300,-1],
    [1299,0,0], [1299,1299,1], [1299,0.5,1298.5],
    [1299,NaN,1299], [1299,Infinity,0], [0,0,0],
    [Number.MAX_SAFE_INTEGER+1,1,1],
    [1299,Number.MAX_SAFE_INTEGER,Number.MAX_SAFE_INTEGER],
  ]) {
    assert.throws(
      () => validateCourierRemunerationSplit(total,a,b),
      /DELIVERY_FINANCIAL_RECONCILIATION_SPLIT_INVALID/
    );
  }
});

test('finance split source is authorized payment capture, never client payment estimate', () => {
  const s = readFileSync('server/delivery/deliveryFinancialReconciliationService.ts','utf8');
  const r = readFileSync('server/delivery/deliveryOpportunityRouter.ts','utf8');
  const a = readFileSync('src/components/admin/AdminDeliveryFinancialReconciliationPanel.tsx','utf8');
  const c = readFileSync('src/components/store/CourierSupervisedHandoffBridge.tsx','utf8');
  const rules = readFileSync('firestore.identity-verification.fragment.rules','utf8');
  assert.match(s,/buildCourierPayableObligationFromCapture/);
  assert.match(s,/payment_capture/);
  assert.match(s,/capture\.storeId !== source\.canonicalStoreId/);
  assert.match(s,/capture\.orderId !== source\.orderId/);
  assert.match(s,/status === 'eligible' \|\| raw\.status === 'settled'/);
  assert.match(s,/adminDb\.runTransaction/);
  assert.match(s,/awaiting_courier_terms/);
  assert.match(s,/awaiting_independent_review/);
  assert.match(s,/approved_pending_manual_execution/);
  assert.match(s,/unresolvedObligationIds/);
  assert.match(s,/reviewerId === data\.operatorId/);
  assert.match(s,/authorityFingerprint/);
  assert.match(s,/transaction\.create\(eventRef/);
  assert.doesNotMatch(s,/transaction\.create\(.*[Oo]bligation/);
  assert.doesNotMatch(s,/transaction\.update\(.*[Cc]laimRef/);
  assert.doesNotMatch(s,/transaction\.update\(.*[Dd]eliveryRef/);
  assert.match(r,/router\.get\('\/admin\/compliance-incidents\/:deliveryId\/remuneration\/preflight'/);
  assert.match(r,/router\.post\('\/admin\/compliance-incidents\/:deliveryId\/remuneration\/approve'/);
  assert.match(r,/router\.post\('\/:deliveryId\/remuneration\/accept-terms'/);
  assert.match(a,/Consultar valor oficial da entrega/);
  assert.match(a,/Revisar independentemente/);
  assert.match(c,/Concordo com minha parcela \(sem pagamento\)/);
  assert.match(rules,/match \/deliveryFinancialReconciliations\/\{deliveryId\}/);
  assert.match(rules,/match \/deliveryFinancialReconciliationEvents\/\{eventId\}/);
});

test('independent executor changes custody atomically and credits are split only on verified buyer completion', () => {
  const executor = readFileSync('server/delivery/deliveryCustodyExecutionService.ts','utf8');
  const buyer = readFileSync('server/delivery/deliveryCustomerHandoffService.ts','utf8');
  const tracking = readFileSync('server/delivery/deliveryTrackingRouter.ts','utf8');
  const admin = readFileSync('src/components/admin/AdminDeliveryFinancialReconciliationPanel.tsx','utf8');
  const root = readFileSync('shared/economicObligations.ts','utf8');
  assert.match(executor,/adminDb\.runTransaction/);
  assert.match(executor,/operator\.role !== 'super_admin'/);
  assert.match(executor,/operatorId === finance\.independentReviewerId/);
  assert.match(executor,/DELIVERY_CUSTODY_EXECUTION_OUTSTANDING_OBLIGATIONS/);
  assert.match(executor,/buildCourierPayableObligationFromCapture/);
  assert.match(executor,/transaction\.update\(claimRef/);
  assert.match(executor,/transaction\.update\(transferRef/);
  assert.match(executor,/latitude:FieldValue\.delete\(\)/);
  assert.match(executor,/transaction\.create\(financialEventRef/);
  assert.doesNotMatch(executor,/transaction\.create\(.*[Oo]bligation/);
  assert.doesNotMatch(executor,/transaction\.create\(completionRef/);
  assert.match(buyer,/buildSupervisedHandoffCourierPayableFromCapture/);
  assert.match(buyer,/originalSplitPayable/);
  assert.match(buyer,/transaction\.create\(originalSplitRef/);
  assert.match(buyer,/reassigned && captures\.length !== 1/);
  assert.match(tracking,/operationalAssignment !== 'recipient_claim_active'/);
  assert.match(admin,/Executar reatribuição com conferência transacional/);
  assert.match(root,/\${whole.id}:handoff/);
});

test('shared canonical handoff obligations retain unique IDs and exact funded cents', async () => {
  const {buildEconomicAllocationSnapshot}=await import('../shared/economicFeesSubsidies');
  const {buildSupervisedHandoffCourierPayableFromCapture}=await import('../shared/economicObligations');
  const allocation=buildEconomicAllocationSnapshot({
    merchandiseGrossMinor:2000,customerPaidMinor:3300,deliveryFeeMinor:1300,
  });
  const capture={
    id:'capture-1',kind:'payment_capture',storeId:'store-1',paymentId:'pay-1',orderId:'order-1',
    amountMinor:3300,occurredAt:'2026-11-16T10:00:00Z',economicAllocation:allocation,
  } as Parameters<typeof buildSupervisedHandoffCourierPayableFromCapture>[0]['capture'];
  const first=buildSupervisedHandoffCourierPayableFromCapture({
    capture,fulfillmentId:'del-1',courierUserId:'courier-a',totalMinor:1300,shareMinor:500,
  });
  const second=buildSupervisedHandoffCourierPayableFromCapture({
    capture,fulfillmentId:'del-1',courierUserId:'courier-b',totalMinor:1300,shareMinor:800,
  });
  assert.ok(first && second);
  assert.notEqual(first.id,second.id);
  assert.notEqual(first.id.replace(':handoff',''),first.id);
  assert.equal(first.amountMinor+second.amountMinor,1300);
  assert.equal(first.funding.customerMinor+second.funding.customerMinor,1300);
  assert.equal(buildSupervisedHandoffCourierPayableFromCapture({
    capture,fulfillmentId:'del-1',courierUserId:'courier-b',totalMinor:1300,shareMinor:0,
  }),null);
  assert.throws(()=>buildSupervisedHandoffCourierPayableFromCapture({
    capture,fulfillmentId:'del-1',courierUserId:'courier-a',totalMinor:1300,shareMinor:1400,
  }));
});
