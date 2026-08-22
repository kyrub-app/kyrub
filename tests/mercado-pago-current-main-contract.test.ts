import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { verifyMercadoPagoWebhookSignature } from '../server/payments/mercadoPagoPixProvider';

const providerSource = readFileSync('server/payments/mercadoPagoPixProvider.ts', 'utf8');
const bridgeSource = readFileSync('server/payments/mercadoPagoCheckoutBridge.ts', 'utf8');
const webhookSource = readFileSync('server/payments/mercadoPagoWebhook.ts', 'utf8');

test('Mercado Pago Pix adapter remains server-only and idempotent', () => {
  assert.match(providerSource, /https:\/\/api\.mercadopago\.com/);
  assert.match(providerSource, /'\/v1\/payments'/);
  assert.match(providerSource, /'X-Idempotency-Key'/);
  assert.match(providerSource, /payment_method_id: 'pix'/);
  assert.match(providerSource, /kyrub_payment_intent_id/);
  assert.doesNotMatch(providerSource, /VITE_.*MERCADO|import\.meta\.env.*MERCADO/i);
});

test('Mercado Pago bridge is a no-op until the protected token exists', () => {
  assert.match(bridgeSource, /if \(!isMercadoPagoPixConfigured\(\)\) return emptyBridge/);
  assert.match(bridgeSource, /status !== 'pending'/);
  assert.match(bridgeSource, /CHECKOUT_PROVIDER_PAYMENT_CONFLICT/);
  assert.match(bridgeSource, /adminDb\.runTransaction/);
});

test('Mercado Pago signed webhook remains the only payment authority', () => {
  assert.match(providerSource, /createHmac\('sha256', secret\)/);
  assert.match(providerSource, /timingSafeEqual/);
  assert.match(webhookSource, /processVerifiedPaymentWebhook/);
});

test('signature verifier accepts the documented HMAC manifest', () => {
  const previous = process.env.MERCADO_PAGO_WEBHOOK_SECRET;
  process.env.MERCADO_PAGO_WEBHOOK_SECRET = 'contract-secret';
  try {
    const dataId = 'ABC123';
    const requestId = 'request-1';
    const ts = '1704908010';
    const manifest = `id:${dataId.toLowerCase()};request-id:${requestId};ts:${ts};`;
    const hash = createHmac('sha256', 'contract-secret').update(manifest).digest('hex');
    assert.doesNotThrow(() => verifyMercadoPagoWebhookSignature({
      dataId,
      headers: {
        'x-request-id': requestId,
        'x-signature': `ts=${ts},v1=${hash}`,
      },
    }));
  } finally {
    if (previous === undefined) delete process.env.MERCADO_PAGO_WEBHOOK_SECRET;
    else process.env.MERCADO_PAGO_WEBHOOK_SECRET = previous;
  }
});
