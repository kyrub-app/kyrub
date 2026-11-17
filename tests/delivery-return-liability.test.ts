import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import {
  DELIVERY_RETURN_LIABILITY_CAUSES,
  classifyDeliveryReturnLiability,
  validateDeliveryReturnLiabilityJustification,
} from '../shared/deliveryReturnLiabilityPolicy';

test('every return reason maps to provisional funding without making deductions or payouts',()=>{
  const expected={
    store_failure:'store',
    platform_failure:'kyrub',
    recipient_absent:'store',
    safety_incident:'contingency',
    courier_conduct_alleged:'disputed',
    damage_or_missing:'disputed',
    undetermined:'disputed',
  };
  for(const cause of DELIVERY_RETURN_LIABILITY_CAUSES){
    const result=classifyDeliveryReturnLiability({cause,receivedCondition:'intact'});
    assert.equal(result.initialFunding,expected[cause]);
    assert.equal(result.recoverFromBuyer,false);
    assert.equal(result.deductFromCourier,false);
    assert.equal(result.financialExecutionAuthorized,false);
  }
  for(const receivedCondition of ['damaged','disputed']){
    for(const cause of DELIVERY_RETURN_LIABILITY_CAUSES){
      const result=classifyDeliveryReturnLiability({cause,receivedCondition});
      assert.equal(result.initialFunding,'disputed');
      assert.equal(result.damageReviewRequired,true);
    }
  }
  assert.throws(()=>classifyDeliveryReturnLiability({cause:'buyer_auto_charge',receivedCondition:'intact'}));
  assert.throws(()=>classifyDeliveryReturnLiability({cause:'recipient_absent',receivedCondition:'missing'}));
  assert.throws(()=>validateDeliveryReturnLiabilityJustification('curto'));
  assert.equal(validateDeliveryReturnLiabilityJustification('   Evidências revisadas cuidadosamente na devolução.   '),
    'Evidências revisadas cuidadosamente na devolução.');
});

test('return responsibility must be guarded by server transactions and independent approval',()=>{
  const service=readFileSync('server/delivery/deliveryReturnLiabilityReviewService.ts','utf8');
  const router=readFileSync('server/delivery/deliveryOpportunityRouter.ts','utf8');
  const rules=readFileSync('firestore.identity-verification.fragment.rules','utf8');
  const ui=readFileSync('src/components/admin/AdminDeliveryReturnLiabilityPanel.tsx','utf8');
  const preview=readFileSync('src/components/admin/AdminDeliveryReturnEconomicsPreview.tsx','utf8');
  assert.match(service,/adminDb\.runTransaction/g);
  assert.match(service,/reviewerId===prior\.proposedBy/);
  assert.match(service,/receiptFingerprint/);
  assert.match(service,/transaction\.create|tx\.create\(eventRef/);
  assert.match(service,/approved_no_financial_execution/);
  assert.doesNotMatch(service,/economicObligations|paymentRefundService|settleFunds|transferFunds/);
  assert.match(router,/\/admin\/returns\/:deliveryId\/liability-review\/propose/);
  assert.match(router,/\/admin\/returns\/:deliveryId\/liability-review\/decision/);
  assert.match(rules,/match \/deliveryReturnLiabilityReviews\/\{deliveryId\}/);
  assert.match(rules,/match \/deliveryReturnLiabilityReviewEvents\/\{eventId\}/);
  assert.match(ui,/Revisar independentemente/);
  assert.match(preview,/AdminDeliveryReturnLiabilityPanel/);
});
