import assert from 'node:assert/strict';
import test from 'node:test';
import {
  assertKyrubDeliverySettlementEligible,
  evaluateKyrubDeliveryCompletion,
} from '../server/delivery/deliveryCompletionService';

const base = {
  deliveryId: 'delivery-1',
  orderId: 'order-1',
  storeId: 'store-1',
  buyerId: 'buyer-1',
  courierId: 'courier-1',
  correlationId: 'corr-delivery-1',
};

test('courier completion alone does not release settlement', () => {
  const completion = evaluateKyrubDeliveryCompletion({
    ...base,
    deliveryStatus: 'done',
  });
  assert.equal(completion.status, 'awaiting_buyer_confirmation');
  assert.equal(completion.settlementEligible, false);
  assert.throws(
    () => assertKyrubDeliverySettlementEligible(completion),
    /DELIVERY_SETTLEMENT_BLOCKED/
  );
});

test('buyer confirmation after done makes the delivery settlement-eligible', () => {
  const completion = evaluateKyrubDeliveryCompletion({
    ...base,
    deliveryStatus: 'done',
    buyerConfirmed: true,
    confirmedAt: '2026-08-21T20:30:00.000Z',
  });
  assert.equal(completion.status, 'confirmed');
  assert.equal(completion.settlementEligible, true);
  assert.equal(completion.confirmedBy, 'buyer-1');
  assert.doesNotThrow(() => assertKyrubDeliverySettlementEligible(completion));
});

test('unfinished delivery cannot become settlement-eligible even with a confirmation flag', () => {
  const completion = evaluateKyrubDeliveryCompletion({
    ...base,
    deliveryStatus: 'delivering',
    buyerConfirmed: true,
    confirmedAt: '2026-08-21T20:30:00.000Z',
  });
  assert.equal(completion.status, 'awaiting_delivery');
  assert.equal(completion.settlementEligible, false);
});

test('dispute always blocks settlement', () => {
  const completion = evaluateKyrubDeliveryCompletion({
    ...base,
    deliveryStatus: 'done',
    buyerConfirmed: true,
    disputed: true,
    confirmedAt: '2026-08-21T20:30:00.000Z',
  });
  assert.equal(completion.status, 'disputed');
  assert.equal(completion.settlementEligible, false);
});
