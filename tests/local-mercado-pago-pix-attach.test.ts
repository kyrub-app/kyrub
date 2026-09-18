import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { parseLocalPixProviderAttachInput } from '../shared/localPaymentProvider';

const service = readFileSync(
  'server/attendance/localMercadoPagoPixService.ts',
  'utf8'
);
const router = readFileSync(
  'server/attendance/localAttendanceRouter.ts',
  'utf8'
);
const provider = readFileSync(
  'server/payments/mercadoPagoPixProvider.ts',
  'utf8'
);

test('local Pix attach input accepts opaque ids only and rejects financial browser overrides', () => {
  assert.deepEqual(parseLocalPixProviderAttachInput({
    storeId: 'owner-1',
    paymentIntentId: 'pi_local_1',
    paymentId: 'pay_local_1',
  }), {
    storeId: 'owner-1',
    paymentIntentId: 'pi_local_1',
    paymentId: 'pay_local_1',
  });
  for (const field of ['amount', 'email', 'context', 'method', 'buyerId', 'orderId']) {
    assert.throws(() => parseLocalPixProviderAttachInput({
      storeId: 'owner-1',
      paymentIntentId: 'pi_local_1',
      paymentId: 'pay_local_1',
      [field]: 'browser-value',
    }), /LOCAL_PIX_PROVIDER_UNSUPPORTED_FIELD/);
  }
});

test('attach revalidates canonical order, identity, approval, context and balance before PSP call', () => {
  assert.match(service, /resolveInPersonOrderStoreContext/);
  assert.match(service, /normalizeCanonicalPaymentIntent/);
  assert.match(service, /normalizeCanonicalPayment/);
  assert.match(service, /parseServiceLocationSnapshot\(order\.serviceLocation\)/);
  assert.match(service, /order\.source === 'customer'/);
  assert.match(service, /order\.status === 'pending'/);
  assert.match(service, /!clean\(order\.operatorId/);
  assert.match(service, /LOCAL_PIX_PROVIDER_ATTENDANCE_APPROVAL_REQUIRED/);
  assert.match(service, /users\/\$\{intent\.buyerId\}/);
  assert.match(service, /payerEmail/);
  assert.match(service, /classifyCompatiblePaymentRecord/);
  assert.match(service, /isPaymentAuthoritativelyPaid/);
  assert.match(service, /LOCAL_PIX_PROVIDER_OTHER_PAYMENT_PENDING/);
  assert.match(service, /Math\.abs\(remaining - intent\.amount\) > 0\.009/);
  assert.match(service, /LOCAL_PIX_PROVIDER_INTENT_STALE/);
  assert.doesNotMatch(service, /request\.email|request\.amount|candidate\.email|candidate\.amount/);
});

test('shared Mercado Pago provider requires server-supplied email for existing-order intent', () => {
  assert.match(provider, /ExistingOrderCanonicalPaymentIntent/);
  assert.match(provider, /payerEmail: string/);
  assert.match(provider, /input\.intent\.context === 'marketplace'/);
  assert.match(provider, /input\.intent\.orderDraft\.buyerEmail/);
  assert.match(provider, /input\.payerEmail/);
  assert.match(provider, /X-Idempotency-Key/);
  assert.match(provider, /kyrub_payment_id/);
  assert.match(provider, /kyrub_payment_intent_id/);
});

test('provider binding is idempotent and does not mutate order payment state', () => {
  assert.match(service, /existingProviderPaymentId/);
  assert.match(service, /getMercadoPagoPixCheckout/);
  assert.match(service, /createMercadoPagoPixPayment/);
  assert.match(service, /bindProviderPayment/);
  assert.match(service, /provider: 'mercado-pago'/);
  assert.match(service, /providerIntentId: input\.providerPaymentId/);
  assert.match(service, /providerPaymentId: input\.providerPaymentId/);
  assert.doesNotMatch(service, /paidQuantity/);
  assert.doesNotMatch(service, /paymentStatus\s*:/);
  assert.doesNotMatch(service, /transaction\.(set|update)\(orderRef/);
});

test('owner-authorized local route attaches Pix without accepting payer or amount fields', () => {
  assert.match(router, /router\.post\('\/payment-intents\/mercado-pago-pix'/);
  assert.match(router, /requireStoreAuthority/);
  assert.match(router, /attachMercadoPagoPixToLocalIntent/);
  assert.match(router, /authenticatedUserId: representation\.authenticatedUserId/);
  assert.doesNotMatch(router, /request\.body\?\.amount/);
  assert.doesNotMatch(router, /request\.body\?\.email/);
});
