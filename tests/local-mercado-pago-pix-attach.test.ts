import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { parseLocalPixProviderAttachInput } from '../shared/localPaymentProvider';
import type { ExistingOrderCanonicalPaymentIntent } from '../src/utils/canonicalPaymentIntent';
import { createMercadoPagoPixPayment } from '../server/payments/mercadoPagoPixProvider';

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
  assert.match(service, /authoritativelyPaidAmount \+= candidate\.amount/);
  assert.match(service, /Math\.abs\(remaining - intent\.amount\) > 0\.009/);
  assert.match(service, /LOCAL_PIX_PROVIDER_INTENT_STALE/);
  assert.doesNotMatch(service, /request\.body\?\.(amount|email)|request\.(amount|email)/);
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

test('mocked local Mercado Pago provider sends only canonical amount plus server-resolved payer and returns QR data', async () => {
  const originalFetch = globalThis.fetch;
  const originalToken = process.env.MERCADO_PAGO_ACCESS_TOKEN;
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
  let capturedUrl = '';
  let capturedInit: RequestInit | undefined;

  process.env.MERCADO_PAGO_ACCESS_TOKEN = 'test-access-token';
  globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
    capturedUrl = String(input);
    capturedInit = init;
    return new Response(JSON.stringify({
      id: 'mp-local-payment-123',
      status: 'pending',
      date_of_expiration: '2026-09-18T12:15:00.000Z',
      point_of_interaction: {
        transaction_data: {
          qr_code: '000201mock-pix-code',
          qr_code_base64: 'bW9jay1xci1iYXNlNjQ=',
          ticket_url: 'https://example.invalid/mock-pix-ticket',
        },
      },
    }), {
      status: 201,
      headers: { 'content-type': 'application/json' },
    });
  }) as typeof fetch;

  try {
    const checkout = await createMercadoPagoPixPayment({
      intent,
      paymentId: 'pay_local_mock_1',
      payerEmail: ' PAYER@EXAMPLE.COM ',
    });

    assert.equal(capturedUrl, 'https://api.mercadopago.com/v1/payments');
    assert.equal(capturedInit?.method, 'POST');
    const headers = new Headers(capturedInit?.headers);
    assert.equal(headers.get('authorization'), 'Bearer test-access-token');
    assert.equal(headers.get('x-idempotency-key'), intent.idempotencyKey);
    const body = JSON.parse(String(capturedInit?.body)) as Record<string, unknown>;
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
    assert.deepEqual(checkout, {
      provider: 'mercado-pago',
      providerPaymentId: 'mp-local-payment-123',
      status: 'pending',
      qrCode: '000201mock-pix-code',
      qrCodeBase64: 'bW9jay1xci1iYXNlNjQ=',
      ticketUrl: 'https://example.invalid/mock-pix-ticket',
      expiresAt: '2026-09-18T12:15:00.000Z',
    });
  } finally {
    globalThis.fetch = originalFetch;
    if (originalToken === undefined) delete process.env.MERCADO_PAGO_ACCESS_TOKEN;
    else process.env.MERCADO_PAGO_ACCESS_TOKEN = originalToken;
  }
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
