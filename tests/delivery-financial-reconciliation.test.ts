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
