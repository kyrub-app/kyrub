import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const service = readFileSync(
  'server/attendance/localPendingPaymentService.ts',
  'utf8'
);
const router = readFileSync(
  'server/attendance/localAttendanceRouter.ts',
  'utf8'
);

test('pending local payment recovery is fail-closed and uses the explicit intent link', () => {
  assert.match(service, /where\('orderId', '==', orderId\)/);
  assert.match(service, /classifyCompatiblePaymentRecord/);
  assert.match(service, /legacy_table_payment_mirror/);
  assert.match(service, /payment\.status === 'pending'/);
  assert.match(service, /pending\.length === 0/);
  assert.match(service, /pending\.length !== 1/);
  assert.match(service, /payment\.paymentIntentId/);
  assert.match(service, /LOCAL_PENDING_PAYMENT_LINK_REQUIRED/);
  assert.match(service, /paymentIntents\/\$\{paymentIntentId\}/);
  assert.match(service, /normalizeCanonicalPaymentIntent/);
  assert.match(service, /intent\.target\.kind !== 'existing_order'/);
  assert.match(service, /intent\.target\.orderId !== payment\.orderId/);
  assert.match(service, /intent\.id !== payment\.paymentIntentId/);
  assert.match(service, /intent\.idempotencyKey !== payment\.idempotencyKey/);
});

test('recovery never guesses between payments or accepts partial provider binding', () => {
  assert.match(service, /snapshot\.size >= MAX_PAYMENT_RECORDS_PER_ORDER/);
  assert.match(service, /LOCAL_PENDING_PAYMENT_RECONCILIATION_REQUIRED/);
  assert.match(service, /hasProviderState && !providerReady/);
  assert.match(service, /LOCAL_PENDING_PAYMENT_PROVIDER_STATE_INVALID/);
  assert.match(service, /intentProviderId === paymentProviderId/);
  assert.doesNotMatch(service, /startsWith\('pay_local_'/);
  assert.doesNotMatch(service, /replace\(.+pay_local_/);
});

test('pending recovery is read-only and does not call a PSP or mutate order/payment state', () => {
  assert.doesNotMatch(service, /createMercadoPagoPixPayment|getMercadoPagoPixCheckout/);
  assert.doesNotMatch(service, /runTransaction/);
  assert.doesNotMatch(service, /\.set\(|\.update\(|\.delete\(/);
  assert.doesNotMatch(service, /paymentStatus|paidQuantity/);
});

test('owner-authorized GET exposes only the pending pair for store and order scope', () => {
  assert.match(router, /router\.get\('\/payment-intents\/pending'/);
  assert.match(router, /requireStoreAuthority/);
  assert.match(router, /loadPendingLocalPayment/);
  assert.match(router, /legacyStoreId: storeId/);
  assert.match(router, /orderId/);
  assert.doesNotMatch(router, /request\.query\.amount|request\.query\.email/);
});
