import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const webhook = readFileSync('server/payments/mercadoPagoWebhook.ts', 'utf8');
const service = readFileSync(
  'server/delivery/customerDestinationOrderResolutionService.ts',
  'utf8'
);

test('paid marketplace order prepares destination before materialization and attaches it after', () => {
  const prepareIndex = webhook.indexOf('prepareCustomerDestinationResolutionForPaymentIntent');
  const processIndex = webhook.indexOf('processVerifiedPaymentWebhook({');
  const attachIndex = webhook.indexOf('attachPreparedCustomerDestinationResolutionToOperationalOrder');
  assert.ok(prepareIndex >= 0);
  assert.ok(processIndex > prepareIndex);
  assert.ok(attachIndex >= 0);
  assert.match(webhook, /await attachPreparedCustomerDestinationResolutionToOperationalOrder/);
});

test('destination resolution is frozen by store order and payment intent identity', () => {
  assert.match(service, /orderDestinationResolutions/);
  assert.match(service, /paymentIntentId/);
  assert.match(service, /reference\.create\(/);
  assert.match(service, /CUSTOMER_DESTINATION_RESOLUTION_CONFLICT/);
});

test('operational order receives server-authoritative resolution metadata only after it exists', () => {
  assert.match(service, /artifacts\/\$\{storeId\}\/public\/data\/customerOrders/);
  assert.match(service, /customerDestinationResolutionAuthority: 'kyrub_server'/);
  assert.match(service, /customerDestinationResolutionSource: 'payment_intent_order_birth'/);
  assert.match(service, /if \(!snapshot\.exists\) return/);
});

test('order-birth resolution does not mint geofence radius or economic state', () => {
  assert.doesNotMatch(service, /radiusMeters|customerGeofenceSnapshot/);
  assert.doesNotMatch(service, /obligation|settlement|payout|wallet|custod|paidWaiting/i);
});
