import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { verifyMercadoPagoWebhookSignature } from '../server/payments/mercadoPagoPixProvider';

const drawerSource = readFileSync(
  'src/components/modals/B2CCartDrawer.tsx',
  'utf8'
);
const checkoutClientSource = readFileSync(
  'src/utils/marketplaceCheckout.ts',
  'utf8'
);
const paymentOverlaySource = readFileSync(
  'src/components/modals/PixPaymentOverlay.tsx',
  'utf8'
);
const intentRouterSource = readFileSync(
  'server/payments/paymentIntentRouter.ts',
  'utf8'
);
const providerSource = readFileSync(
  'server/payments/mercadoPagoPixProvider.ts',
  'utf8'
);
const webhookSource = readFileSync(
  'server/payments/mercadoPagoWebhook.ts',
  'utf8'
);
const vercelActionSource = readFileSync('api/action-execute.ts', 'utf8');
const vercelConfigSource = readFileSync('vercel.json', 'utf8');
const serverSource = readFileSync('server.ts', 'utf8');
const materializationSource = readFileSync(
  'src/utils/paymentOrderMaterialization.ts',
  'utf8'
);

test('delivery and pickup initiate payment without materializing an order in the browser', () => {
  assert.match(
    drawerSource,
    /fulfillmentType === 'delivery' \|\| fulfillmentType === 'pickup'/
  );
  assert.match(drawerSource, /initiateMarketplaceCheckout\(user/);
  assert.match(drawerSource, /nenhum pedido foi enviado à loja/i);
  assert.match(drawerSource, /Continuar para pagamento Pix/);

  const marketplaceBranch = drawerSource.indexOf(
    "fulfillmentType === 'delivery'"
  );
  const directOrderBuild = drawerSource.indexOf(
    'const order = buildCustomerOrder'
  );
  assert.ok(marketplaceBranch >= 0);
  assert.ok(directOrderBuild > marketplaceBranch);
  assert.match(
    drawerSource.slice(marketplaceBranch, directOrderBuild),
    /return;/
  );
});

test('dine-in keeps the attendance order path', () => {
  assert.match(drawerSource, /const order = buildCustomerOrder/);
  assert.match(drawerSource, /await persistCustomerOrder\(order\)/);
  assert.match(drawerSource, /No local/);
  assert.match(drawerSource, /aprovação do atendimento/);
});

test('checkout client sends only item identity and quantity, not authoritative prices', () => {
  assert.match(checkoutClientSource, /productId: item\.product\.id/);
  assert.match(checkoutClientSource, /quantity: item\.quantity/);
  assert.doesNotMatch(checkoutClientSource, /price: item\.product\.price/);
  assert.match(checkoutClientSource, /\/api\/payments\/intents/);
  assert.match(checkoutClientSource, /method: 'pix'/);
});

test('backend reconstructs marketplace totals from the published store catalog', () => {
  assert.match(
    intentRouterSource,
    /adminDb\.doc\(`tenants\/\$\{input\.storeId\}`\)/
  );
  assert.match(intentRouterSource, /tenant\?\.publicationStatus !== 'published'/);
  assert.match(intentRouterSource, /catalogProducts\(tenant\?\.publicProducts\)/);
  assert.match(intentRouterSource, /product\.price \* item\.quantity/);
  assert.match(intentRouterSource, /unitPrice: product\.price/);
  assert.match(intentRouterSource, /CHECKOUT_PRODUCT_NOT_AVAILABLE/);
});

test('backend atomically creates pending PaymentIntent and Payment with idempotency', () => {
  assert.match(intentRouterSource, /status: 'pending'/);
  assert.match(intentRouterSource, /context: 'marketplace'/);
  assert.match(intentRouterSource, /paymentIntents\/\$\{intentId\}/);
  assert.match(intentRouterSource, /payments\/\$\{paymentId\}/);
  assert.match(intentRouterSource, /adminDb\.runTransaction/);
  assert.match(intentRouterSource, /existingIntent/);
  assert.match(intentRouterSource, /existingPayment/);
  assert.match(intentRouterSource, /idempotencyKey/);
  assert.doesNotMatch(
    intentRouterSource,
    /simulat|mock.*success|isMockGatewaySuccessful/i
  );
});

test('Mercado Pago adapter creates Pix server-side with provider idempotency and Kyrub metadata', () => {
  assert.match(providerSource, /https:\/\/api\.mercadopago\.com/);
  assert.match(providerSource, /'\/v1\/payments'/);
  assert.match(providerSource, /'X-Idempotency-Key': intent\.idempotencyKey/);
  assert.match(providerSource, /payment_method_id: 'pix'/);
  assert.match(providerSource, /transaction_amount: intent\.amount/);
  assert.match(providerSource, /kyrub_store_id: intent\.storeId/);
  assert.match(providerSource, /kyrub_payment_id: paymentId/);
  assert.match(providerSource, /kyrub_payment_intent_id: intent\.id/);
  assert.doesNotMatch(providerSource, /VITE_.*MERCADO|import\.meta\.env.*MERCADO/i);
});

test('Mercado Pago webhook signature is HMAC verified before authoritative lookup', () => {
  assert.match(providerSource, /createHmac\('sha256', secret\)/);
  assert.match(providerSource, /timingSafeEqual/);
  assert.match(providerSource, /normalizedDataId.*toLowerCase/);
  assert.match(providerSource, /request-id:\$\{xRequestId\}/);
  assert.match(providerSource, /verifiedMercadoPagoPaymentEvent/);
  assert.match(webhookSource, /processVerifiedPaymentWebhook/);
});

test('Mercado Pago signature verifier accepts the documented manifest and rejects tampering', () => {
  const previousSecret = process.env.MERCADO_PAGO_WEBHOOK_SECRET;
  process.env.MERCADO_PAGO_WEBHOOK_SECRET = 'unit-test-secret';
  try {
    const dataId = 'ABC123';
    const requestId = 'request-9';
    const timestamp = '1704908010';
    const manifest = `id:${dataId.toLowerCase()};request-id:${requestId};ts:${timestamp};`;
    const signature = createHmac('sha256', 'unit-test-secret')
      .update(manifest)
      .digest('hex');

    assert.doesNotThrow(() =>
      verifyMercadoPagoWebhookSignature({
        dataId,
        headers: {
          'x-request-id': requestId,
          'x-signature': `ts=${timestamp},v1=${signature}`,
        },
      })
    );
    assert.throws(() =>
      verifyMercadoPagoWebhookSignature({
        dataId,
        headers: {
          'x-request-id': requestId,
          'x-signature': `ts=${timestamp},v1=${'0'.repeat(64)}`,
        },
      })
    );
  } finally {
    if (previousSecret === undefined) delete process.env.MERCADO_PAGO_WEBHOOK_SECRET;
    else process.env.MERCADO_PAGO_WEBHOOK_SECRET = previousSecret;
  }
});

test('Pix UI shows QR, copy-and-paste and provider link without claiming payment', () => {
  assert.match(paymentOverlaySource, /pixQrCodeBase64/);
  assert.match(paymentOverlaySource, /pixQrCode/);
  assert.match(paymentOverlaySource, /pixTicketUrl/);
  assert.match(paymentOverlaySource, /Copiar código Pix/);
  assert.match(paymentOverlaySource, /só entra na loja depois/i);
  assert.doesNotMatch(paymentOverlaySource, /pagamento concluído|pedido confirmado/i);
});

test('Express and Vercel expose intent and webhook without adding a function', () => {
  assert.match(serverSource, /createPaymentIntentRouter/);
  assert.match(serverSource, /"\/api\/payments"/);
  assert.match(vercelConfigSource, /"source": "\/api\/payments\/intents"/);
  assert.match(
    vercelConfigSource,
    /"destination": "\/api\/action-execute\?transport=marketplace-payment-intent"/
  );
  assert.match(
    vercelConfigSource,
    /"source": "\/api\/payments\/webhooks\/mercado-pago"/
  );
  assert.match(
    vercelConfigSource,
    /"destination": "\/api\/action-execute\?transport=mercado-pago-webhook"/
  );
  assert.match(vercelActionSource, /transport === 'marketplace-payment-intent'/);
  assert.match(vercelActionSource, /transport === 'mercado-pago-webhook'/);
  assert.match(vercelActionSource, /processMercadoPagoWebhook/);
});

test('paid materialization preserves checkout item metadata', () => {
  assert.match(materializationSource, /note: item\.note \?\? ''/);
  assert.match(materializationSource, /image: item\.image \?\? ''/);
  assert.match(materializationSource, /isService: item\.isService === true/);
});
