import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { parseLocalPixProviderAttachInput } from '../shared/localPaymentProvider';
import type { ExistingOrderCanonicalPaymentIntent } from '../src/utils/canonicalPaymentIntent';
import { buildMercadoPagoPixPaymentRequest } from '../server/payments/mercadoPagoPixProvider';

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

test('attach revalidates canonical order, identity, approval, context and billable balance before PSP call', () => {
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
  assert.match(service, /summarizeLocalOrderPayable\(order\)/);
  assert.match(service, /payable\.hasOperationalPaidQuantity/);
  assert.match(service, /payable\.billableAmount - authoritativelyPaidAmount/);
  assert.match(service, /Math\.abs\(remaining - intent\.amount\) > 0\.009/);
  assert.match(service, /LOCAL_PIX_PROVIDER_INTENT_STALE/);
  assert.doesNotMatch(service, /orderTotal - authoritativelyPaidAmount/);
  assert.doesNotMatch(service, /request\.body\?\.(amount|email)|request\.(amount|email)/);
});

test('shared Mercado Pago adapter still requires server-supplied email for existing-order intent', () => {
  assert.match(provider, /ExistingOrderCanonicalPaymentIntent/);
  assert.match(provider, /payerEmail: string/);
  assert.match(provider, /input\.intent\.context === 'marketplace'/);
  assert.match(provider, /input\.intent\.orderDraft\.buyerEmail/);
  assert.match(provider, /input\.payerEmail/);
  assert.match(provider, /X-Idempotency-Key/);
  assert.match(provider, /kyrub_payment_id/);
  assert.match(provider, /kyrub_payment_intent_id/);
});

test('pure local Mercado Pago request uses canonical amount plus server-resolved payer and idempotency', () => {
  const intent: ExistingOrderCanonicalPaymentIntent = {
    id: 'pi_local_mock_1',
    storeId: 'store-1',
    buyerId: 'buyer-1',
    context: 'pos',
    target: { kind: 'existing_order', orderId: 'order-1' },
    method: 'pix',
    status: 'pending',
    amount: 47.5,
    currency: 'BRL',
    provider: '',
    providerIntentId: '',
    idempotencyKey: 'local-pix-mock-idempotency-1',
    createdAt: '2026-09-18T12:00:00.000Z',
    updatedAt: '2026-09-18T12:00:00.000Z',
    expiresAt: '2026-09-18T12:15:00.000Z',
  };

  const request = buildMercadoPagoPixPaymentRequest({
    intent,
    paymentId: 'pay_local_mock_1',
    payerEmail: ' PAYER@EXAMPLE.COM ',
  });

  assert.equal(request.path, '/v1/payments');
  assert.equal(request.init.method, 'POST');
  const headers = new Headers(request.init.headers);
  assert.equal(headers.get('x-idempotency-key'), intent.idempotencyKey);
  const body = JSON.parse(String(request.init.body)) as Record<string, unknown>;
  assert.equal(body.transaction_amount, intent.amount);
  assert.equal(body.payment_method_id, 'pix');
  assert.equal(body.date_of_expiration, intent.expiresAt);
  assert.equal(body.external_reference, intent.id);
  assert.deepEqual(body.payer, { email: 'payer@example.com' });
  assert.deepEqual(body.metadata, {
    kyrub_store_id: intent.storeId,
    kyrub_payment_id: 'pay_local_mock_1',
    kyrub_payment_intent_id: intent.id,
  });
  assert.match(provider, /const request = buildMercadoPagoPixPaymentRequest\(input\)/);
  assert.match(provider, /mercadoPagoRequest<MercadoPagoPayment>\(/);
  assert.match(provider, /return normalizePixCheckout\(payment\)/);
});

test('provider binding is idempotent through the adapter and does not mutate order payment state', () => {
  assert.match(service, /existingProviderPaymentId/);
  assert.match(service, /resolvePrimaryPaymentProvider/);
  assert.match(service, /provider\.getPixCheckout/);
  assert.match(service, /provider\.createLocalPixPayment/);
  assert.match(service, /bindProviderPayment/);
  assert.match(service, /provider: provider\.id/);
  assert.match(service, /providerIntentId: input\.providerPaymentId/);
  assert.match(service, /providerPaymentId: input\.providerPaymentId/);
  assert.match(service, /attachMercadoPagoPixToLocalIntent = attachPixProviderToLocalIntent/);
  assert.doesNotMatch(service, /createMercadoPagoPixPayment|getMercadoPagoPixCheckout/);
  assert.doesNotMatch(service, /paidQuantity\s*:/);
  assert.doesNotMatch(service, /paymentStatus\s*:/);
  assert.doesNotMatch(service, /transaction\.(set|update)\(orderRef/);
});

test('owner-authorized local route preserves compatibility without accepting payer or amount fields', () => {
  assert.match(router, /router\.post\('\/payment-intents\/mercado-pago-pix'/);
  assert.match(router, /requireStoreAuthority/);
  assert.match(router, /attachMercadoPagoPixToLocalIntent/);
  assert.match(router, /authenticatedUserId: representation\.authenticatedUserId/);
  assert.doesNotMatch(router, /request\.body\?\.amount/);
  assert.doesNotMatch(router, /request\.body\?\.email/);
});
