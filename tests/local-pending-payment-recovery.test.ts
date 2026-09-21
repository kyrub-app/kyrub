import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const service = readFileSync(
  'server/attendance/localPendingPaymentService.ts',
  'utf8'
);
const expirationService = readFileSync(
  'server/attendance/localPendingPaymentExpirationService.ts',
  'utf8'
);
const financialContextService = readFileSync(
  'server/attendance/localOrderFinancialContextService.ts',
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

test('expired unbound attempts are released without touching provider-bound Pix', () => {
  assert.match(expirationService, /payment\.status !== 'pending'/);
  assert.match(expirationService, /clean\(input\.payment\.provider/);
  assert.match(expirationService, /clean\(input\.payment\.providerPaymentId\)/);
  assert.match(expirationService, /clean\(intent\.provider/);
  assert.match(expirationService, /clean\(intent\.providerIntentId\)/);
  assert.match(expirationService, /Date\.parse\(intent\.expiresAt\)/);
  assert.match(expirationService, /expiresAt > now\.getTime\(\)/);
  assert.match(expirationService, /assertPaymentStatusTransition\(payment\.status, 'expired'\)/);
  assert.match(expirationService, /transaction\.update\(paymentRef, \{ status: 'expired', updatedAt \}\)/);
  assert.match(expirationService, /transaction\.update\(intentRef, \{ status: 'expired', updatedAt \}\)/);
  assert.doesNotMatch(expirationService, /paymentStatus|paidQuantity/);
});

test('financial context expires stale unbound attempts before projecting pending count', () => {
  assert.match(financialContextService, /expireStaleUnboundLocalPayment/);
  assert.match(financialContextService, /payment\.status === 'pending'/);
  assert.match(financialContextService, /!payment\.provider\.trim\(\)/);
  assert.match(financialContextService, /!payment\.providerPaymentId\.trim\(\)/);
  const expiryIndex = financialContextService.indexOf('expireStaleUnboundLocalPayment({');
  const projectionIndex = financialContextService.indexOf('buildCanonicalOrderFinancialProjection({');
  assert.ok(expiryIndex >= 0 && projectionIndex > expiryIndex);
});

test('owner-authorized GET exposes only the pending pair for store and order scope', () => {
  assert.match(router, /router\.get\('\/payment-intents\/pending'/);
  assert.match(router, /requireStoreAuthority/);
  assert.match(router, /loadPendingLocalPayment/);
  assert.match(router, /legacyStoreId: storeId/);
  assert.match(router, /orderId/);
  assert.doesNotMatch(router, /request\.query\.amount|request\.query\.email/);
});
