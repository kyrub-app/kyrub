import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import './local-order-payable.test';
import './local-pending-payment-recovery.test';
import './local-pix-checkout-ui.test';
import { parseLocalPaymentIntentCreateInput } from '../shared/localPaymentIntent';
import { normalizeCanonicalPayment } from '../src/utils/canonicalPayment';

const basePayment = {
  id: 'pay-local-1',
  storeId: 'store-1',
  orderId: 'order-1',
  buyerId: 'buyer-1',
  amount: 20,
  currency: 'BRL' as const,
  method: 'pix' as const,
  context: 'pos' as const,
  status: 'pending' as const,
  provider: '',
  providerPaymentId: '',
  idempotencyKey: 'idem-1',
  createdAt: '2026-09-18T12:00:00.000Z',
  updatedAt: '2026-09-18T12:00:00.000Z',
  paidAt: '',
  refundedAt: '',
};

test('canonical payment keeps historical compatibility while accepting an explicit intent link', () => {
  const historical = normalizeCanonicalPayment(basePayment);
  assert.equal(historical.paymentIntentId, undefined);

  const linked = normalizeCanonicalPayment({
    ...basePayment,
    paymentIntentId: '  pi-local-1  ',
  });
  assert.equal(linked.paymentIntentId, 'pi-local-1');
  assert.throws(() => normalizeCanonicalPayment({
    ...basePayment,
    paymentIntentId: '   ',
  }), /payment intent id is required when provided/);
});

test('local payment intent input accepts only scope and idempotency', () => {
  assert.deepEqual(
    parseLocalPaymentIntentCreateInput({
      storeId: 'owner-1',
      orderId: 'staff-order-1',
      idempotencyKey: 'checkout-attempt-1',
    }),
    {
      storeId: 'owner-1',
      orderId: 'staff-order-1',
      idempotencyKey: 'checkout-attempt-1',
    }
  );
  for (const field of ['amount', 'email', 'method', 'context', 'buyerId']) {
    assert.throws(() => parseLocalPaymentIntentCreateInput({
      storeId: 'owner-1',
      orderId: 'staff-order-1',
      idempotencyKey: 'checkout-attempt-1',
      [field]: 'browser-value',
    }), /LOCAL_PAYMENT_INTENT_UNSUPPORTED_FIELD/);
  }
});

test('server derives buyer, context and remaining amount from canonical state', () => {
  const service = readFileSync(
    'server/attendance/localPaymentIntentService.ts',
    'utf8'
  );
  assert.match(service, /resolveInPersonOrderStoreContext/);
  assert.match(service, /stores\/\$\{storeContext\.canonicalStoreId\}\/orders/);
  assert.match(service, /parseServiceLocationSnapshot\(order\.serviceLocation\)/);
  assert.match(service, /location\.kind === 'table' \? 'table' : 'pos'/);
  assert.match(service, /buyerId\.startsWith\('local-order:'\)/);
  assert.match(service, /buyerIdentityStatus !== 'verified_account'/);
  assert.match(service, /users\/\$\{buyerId\}/);
  assert.match(service, /validEmail/);
  assert.match(service, /classifyCompatiblePaymentRecord/);
  assert.match(service, /isPaymentAuthoritativelyPaid/);
  assert.match(service, /summarizeLocalOrderPayable\(order\)/);
  assert.match(service, /expectedAmount = payable\.billableAmount/);
  assert.match(service, /payable\.hasOperationalPaidQuantity/);
  assert.match(service, /expectedAmount - authoritativelyPaidAmount/);
  assert.doesNotMatch(service, /candidate\.amount|request\.amount|value\.amount/);
  assert.doesNotMatch(service, /candidate\.email|request\.email|value\.email/);
});

test('local intent creation is transactional, idempotent and persists its payment link', () => {
  const service = readFileSync(
    'server/attendance/localPaymentIntentService.ts',
    'utf8'
  );
  assert.match(service, /adminDb\.runTransaction/);
  assert.match(service, /LOCAL_PAYMENT_INTENT_IDEMPOTENCY_CONFLICT/);
  assert.match(service, /LOCAL_PAYMENT_INTENT_PAYMENT_ALREADY_PENDING/);
  assert.match(service, /LOCAL_PAYMENT_INTENT_RECONCILIATION_REQUIRED/);
  assert.match(service, /paymentSnapshot\.size >= MAX_PAYMENT_RECORDS_PER_ORDER/);
  assert.match(service, /LOCAL_PAYMENT_INTENT_ORDER_TOTAL_INVALID/);
  assert.match(service, /LOCAL_PAYMENT_INTENT_ALREADY_PAID/);
  assert.match(service, /target: \{\s*kind: 'existing_order'/);
  assert.match(service, /paymentIntentId: intent\.id/);
  assert.match(service, /input\.payment\.paymentIntentId !== undefined/);
  assert.match(service, /input\.payment\.paymentIntentId !== input\.intent\.id/);
  assert.match(service, /context,/);
  assert.match(service, /method: 'pix'/);
  assert.match(service, /status: 'pending'/);
  assert.match(service, /transaction\.set\(intentRef, intent\)/);
  assert.match(service, /transaction\.set\(paymentRef, payment\)/);
  assert.doesNotMatch(service, /transaction\.(set|update)\(orderRef/);
  assert.doesNotMatch(service, /paidQuantity\s*:/);
});

test('owner-authorized endpoint creates the pending pair but never calls a PSP', () => {
  const router = readFileSync(
    'server/attendance/localAttendanceRouter.ts',
    'utf8'
  );
  const service = readFileSync(
    'server/attendance/localPaymentIntentService.ts',
    'utf8'
  );
  assert.match(router, /router\.post\('\/payment-intents'/);
  assert.match(router, /requireStoreAuthority/);
  assert.match(router, /createLocalPaymentIntent/);
  assert.match(router, /authenticatedUserId: representation\.authenticatedUserId/);
  assert.doesNotMatch(router, /request\.body\?\.amount/);
  assert.doesNotMatch(router, /request\.body\?\.email/);
  assert.doesNotMatch(service, /mercadoPago|MercadoPago|attachMercadoPago|createMercadoPago/i);
  assert.match(service, /providerReady: false/);
});

test('browser Firestore rules still expose no direct canonical payment write path', () => {
  const rules = readFileSync('firestore.rules', 'utf8');
  assert.doesNotMatch(rules, /match \/paymentIntents\//);
  assert.doesNotMatch(rules, /match \/payments\//);
  assert.match(rules, /match \/\{document=\*\*\} \{\s*allow read, write: if false;/);
});
