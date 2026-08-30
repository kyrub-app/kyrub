import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { describe, test } from 'node:test';

const service = readFileSync(
  'server/delivery/deliveryCustomerHandoffService.ts',
  'utf8'
);
const completion = readFileSync(
  'server/delivery/deliveryCompletionService.ts',
  'utf8'
);
const eligibility = readFileSync(
  'shared/economicObligationEligibility.ts',
  'utf8'
);
const obligations = readFileSync(
  'shared/economicObligations.ts',
  'utf8'
);
const waitingObligation = readFileSync(
  'shared/deliveryPaidWaitingObligation.ts',
  'utf8'
);
const router = readFileSync(
  'server/delivery/deliveryOpportunityRouter.ts',
  'utf8'
);
const workEligibility = readFileSync(
  'server/identity/workEligibilityMiddleware.ts',
  'utf8'
);
const courierBridge = readFileSync(
  'src/components/store/KyrubDeliveryStatusSyncBridge.tsx',
  'utf8'
);
const buyerBridge = readFileSync(
  'src/components/store/BuyerDeliveryTrackingBridge.tsx',
  'utf8'
);

describe('buyer-confirmed customer delivery handoff', () => {
  test('courier arrival is only a signal and requires active tracking', () => {
    assert.match(service, /markCourierArrivedAtCustomer/);
    assert.match(service, /clean\(delivery\.status\) !== 'delivering'/);
    assert.match(service, /tracking\?\.active !== true/);
    assert.match(service, /status: 'awaiting_buyer_confirmation'/);
    assert.match(service, /trackingWasActive: true/);
    assert.doesNotMatch(
      service.slice(
        service.indexOf('markCourierArrivedAtCustomer'),
        service.indexOf('confirmBuyerReceivedDelivery')
      ),
      /status:\s*'done'|settlementEligible|eligibleAt/
    );
  });

  test('buyer confirmation is the only Kyrub-order completion authority', () => {
    assert.match(router, /:deliveryId\/customer-arrival/);
    assert.match(router, /:deliveryId\/buyer-confirmation/);
    assert.match(router, /A conclusão da entrega Kyrub depende da confirmação do cliente/);
    assert.match(service, /DELIVERY_BUYER_CONFIRMATION_FORBIDDEN/);
    assert.match(service, /confirmedByBuyerId: buyerId/);
    assert.match(service, /status: 'done'/);
    assert.match(service, /status: 'completed'/);
    assert.match(service, /deliveryCompletions/);
    assert.match(completion, /buyerConfirmed !== true/);
    assert.match(completion, /settlementEligible: true/);
  });

  test('legacy courier sync cannot submit done or delivering', () => {
    const cloudStatuses = courierBridge.match(/CLOUD_STATUSES[\s\S]*?\]\);/)?.[0] ?? '';
    assert.match(cloudStatuses, /'accepted'/);
    assert.doesNotMatch(cloudStatuses, /'done'/);
    assert.doesNotMatch(cloudStatuses, /'delivering'/);
  });

  test('approved courier signals arrival while buyer confirmation stays a buyer action', () => {
    assert.match(workEligibility, /status\|secure-pickup\|customer-arrival/);
    assert.doesNotMatch(workEligibility, /buyer-confirmation/);
    assert.match(courierBridge, /Cheguei ao cliente/);
    assert.match(courierBridge, /customer-arrival/);
    assert.match(buyerBridge, /Recebi meu pedido/);
    assert.match(buyerBridge, /buyer-confirmation/);
  });

  test('buyer-confirmed completion makes only the courier payable eligible', () => {
    assert.match(service, /buildCourierPayableObligationFromCapture/);
    assert.match(service, /buildCourierPayableDeliveryEligibilityUpdate/);
    assert.match(service, /economicLedger/);
    assert.match(eligibility, /buyer_confirmed_delivery/);
    assert.match(eligibility, /kind !== 'courier_payable'/);
    assert.match(eligibility, /status: 'eligible'/);
    assert.match(eligibility, /eligibleAt: confirmedAt/);
  });

  test('paid waiting is a canonical courier obligation with its own source authority', () => {
    assert.match(obligations, /'delivery_paid_waiting'/);
    assert.match(waitingObligation, /kind: 'courier_payable'/);
    assert.match(waitingObligation, /sourceAuthority: 'delivery_paid_waiting'/);
    assert.match(waitingObligation, /status: 'pending'/);
  });

  test('buyer confirmation resolves waiting payable deterministically and makes it eligible atomically', () => {
    assert.match(service, /buildDeliveryPaidWaitingObligationId/);
    assert.match(service, /economicObligationPath\(canonicalStoreId, waitingObligationId\)/);
    assert.match(service, /assertPaidWaitingPayableMatchesDelivery/);
    assert.match(service, /sourceAuthority !== 'delivery_paid_waiting'/);
    assert.match(service, /existingWaitingPayable\.status !== 'pending'/);
    assert.match(service, /transaction\.update\(\s*waitingPayableRef,[\s\S]*?buildCourierPayableDeliveryEligibilityUpdate/);
    assert.match(service, /buyerId,\s*confirmedAt/);
  });

  test('waiting payable cannot be made eligible for another delivery or courier', () => {
    assert.match(service, /obligation\.fulfillmentId !== input\.deliveryId/);
    assert.match(service, /obligation\.beneficiaryPrincipalId !== input\.courierId/);
    assert.match(service, /obligation\.orderId !== input\.orderId/);
    assert.match(service, /obligation\.storeId !== input\.canonicalStoreId/);
    assert.match(service, /DELIVERY_WAITING_PAYABLE_CONFLICT/);
  });

  test('completion eligibility is not settlement, payout, transfer or wallet custody', () => {
    assert.doesNotMatch(service, /settleEconomicObligationFromEvidence|payout|transfer|wallet|custodial/i);
    assert.doesNotMatch(eligibility, /settledAt:\s*confirmedAt|payout|transfer|wallet|custodial/i);
    assert.match(buyerBridge, /não executa pagamento nem transferência/);
  });
});
