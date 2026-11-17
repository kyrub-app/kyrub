import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import {
  RETURN_POLICY_REFERENCE,
} from '../server/delivery/deliveryReturnToStoreService';

test('returned package is a custody state, not completed order or payout',()=>{
  assert.equal(RETURN_POLICY_REFERENCE,'manual_operator_review_no_auto_refund');
  const service=readFileSync('server/delivery/deliveryReturnToStoreService.ts','utf8');
  const route=readFileSync('server/delivery/deliveryOpportunityRouter.ts','utf8');
  const courier=readFileSync('src/components/store/CourierReturnToStorePanel.tsx','utf8');
  const store=readFileSync('src/components/store/StoreDeliveryReturnQueue.tsx','utf8');
  const storeMounted=readFileSync('src/components/store/StoreDeliveryTrackingBridge.tsx','utf8');
  const buyer=readFileSync('src/components/store/BuyerDeliveryTrackingBridge.tsx','utf8');
  const admin=readFileSync('src/components/admin/AdminDeliverySupportQueue.tsx','utf8');
  const handoff=readFileSync('server/delivery/deliveryCustomerHandoffService.ts','utf8');
  const rules=readFileSync('firestore.identity-verification.fragment.rules','utf8');
  assert.match(service,/return_authorized/);
  assert.match(service,/courier_presented_to_store/);
  assert.match(service,/returned_to_store_pending_reconciliation/);
  assert.match(service,/authorization_revoked/);
  assert.match(service,/isFreshCourierTrackingTimestamp/);
  assert.match(service,/assessment\.insideGeofence!==true/);
  assert.match(service,/assessment\.accuracyMeters>100/);
  assert.match(service,/recipientAbsenceReviewRequestedAt/);
  assert.match(service,/ticket\.assignedTo!==operatorId/);
  assert.match(service,/returnCustody:returnMarker/);
  assert.match(service,/status:'returned_to_store'/);
  assert.match(service,/transaction/gi);
  assert.doesNotMatch(service,/economicObligationPath|economicSettlement|captureFunds|issueRefund/);
  assert.match(route,/router\.post\('\/admin\/support-tickets\/:ticketId\/authorize-return'/);
  assert.match(route,/router\.post\('\/admin\/returns\/:deliveryId\/revoke'/);
  assert.match(route,/router\.post\('\/:deliveryId\/return-to-store\/declare'/);
  assert.match(route,/router\.post\('\/:deliveryId\/return-to-store\/confirm-receipt'/);
  assert.match(courier,/Estou na loja com a encomenda/);
  assert.match(store,/Confirmar recebimento físico na loja/);
  assert.match(storeMounted,/StoreDeliveryReturnQueue/);
  assert.match(buyer,/Encomenda devolvida à loja/);
  assert.match(admin,/Autorizar retorno à loja — sem cancelamento/);
  assert.match(handoff,/DELIVERY_RETURN_CUSTODY_HOLD/);
  assert.match(rules,/match \/deliveryReturnProtocols\/\{deliveryId\}/);
  assert.match(rules,/match \/deliveryReturnEvents\/\{eventId\}/);
});
