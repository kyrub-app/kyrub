import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const reservationSource = readFileSync(
  'server/inventory/marketplaceOrderInventoryReservationService.ts',
  'utf8'
);
const checkoutSource = readFileSync(
  'server/payments/mercadoPagoCheckoutBridge.ts',
  'utf8'
);
const expirySource = readFileSync(
  'server/payments/marketplacePaymentExpiryService.ts',
  'utf8'
);
const expiryQueueSource = readFileSync(
  'server/payments/marketplacePaymentExpiryQueueService.ts',
  'utf8'
);
const queueConsumerSource = readFileSync(
  'api/mercado-livre-orders-v2-consumer.ts',
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
const actionExecuteSource = readFileSync('api/action-execute.ts', 'utf8');
const vercelConfig = JSON.parse(readFileSync('vercel.json', 'utf8')) as {
  rewrites?: Array<{ source?: string; destination?: string }>;
  crons?: Array<{ path?: string; schedule?: string }>;
  functions?: Record<string, {
    experimentalTriggers?: Array<{
      type?: string;
      topic?: string;
      retryAfterSeconds?: number;
      initialDelaySeconds?: number;
    }>;
  }>;
};

test('accepted unpaid marketplace orders keep an expiration-aware stock reservation', () => {
  assert.match(reservationSource, /activeExpiresAt/);
  assert.match(reservationSource, /paymentIntentId/);
  assert.match(reservationSource, /syncMarketplaceOrderInventoryReservationExpiry/);
  assert.match(reservationSource, /markMarketplaceOrderInventoryReservationPaymentConfirmed/);
  assert.match(checkoutSource, /effectiveExpiresAt/);
  assert.match(checkoutSource, /syncMarketplaceOrderInventoryReservationExpiry/);
  assert.match(checkoutSource, /enqueueMarketplacePaymentExpiry/);
  assert.match(webhookSource, /markMarketplaceOrderInventoryReservationPaymentConfirmed/);
});

test('expiry reconciliation checks Mercado Pago before releasing stock', () => {
  const providerRead = expirySource.indexOf('getMercadoPagoPayment');
  const providerCancel = expirySource.indexOf('cancelMercadoPagoPayment');
  const terminalRelease = expirySource.indexOf('releaseMarketplaceReservationForTerminalPayment');
  assert.ok(providerRead >= 0);
  assert.ok(providerCancel >= 0);
  assert.ok(terminalRelease >= 0);
  assert.match(expirySource, /where\('activeExpiresAt', '<=', now\)/);
  assert.match(expirySource, /processVerifiedPaymentWebhook/);
  assert.match(providerSource, /method: 'PUT'/);
  assert.match(providerSource, /status: 'cancelled'/);
});

test('Pix expiry uses the existing queue consumer instead of a high-frequency Vercel Cron', () => {
  assert.match(expiryQueueSource, /MARKETPLACE_PAYMENT_EXPIRY_QUEUE_TOPIC/);
  assert.match(expiryQueueSource, /delaySeconds/);
  assert.match(expiryQueueSource, /retentionSeconds/);
  assert.match(expiryQueueSource, /idempotencyKey/);
  assert.match(expiryQueueSource, /expireDueMarketplacePixReservations\(100\)/);
  assert.match(queueConsumerSource, /MARKETPLACE_PAYMENT_EXPIRY_QUEUE_TOPIC/);
  assert.match(queueConsumerSource, /consumeMarketplacePaymentExpiryQueueMessage/);

  const triggers = vercelConfig.functions?.['api/mercado-livre-orders-v2-consumer.ts']
    ?.experimentalTriggers ?? [];
  assert.ok(triggers.some(trigger =>
    trigger.type === 'queue/v2beta' &&
    trigger.topic === 'mercado_livre_orders_v2'
  ));
  assert.ok(triggers.some(trigger =>
    trigger.type === 'queue/v2beta' &&
    trigger.topic === 'marketplace_payment_expiry' &&
    trigger.retryAfterSeconds === 30
  ));
  assert.deepEqual(vercelConfig.crons ?? [], []);
});

test('manual expiry maintenance remains available as a protected recovery path', () => {
  assert.match(actionExecuteSource, /transport === 'marketplace-payment-expiry'/);
  assert.match(actionExecuteSource, /process\.env\.CRON_SECRET/);
  assert.match(actionExecuteSource, /bearerToken\(authorization\) !== cronSecret/);
  assert.match(actionExecuteSource, /expireDueMarketplacePixReservations/);

  const rewrite = vercelConfig.rewrites?.find(
    entry => entry.source === '/api/payments/maintenance/expire'
  );
  assert.deepEqual(rewrite, {
    source: '/api/payments/maintenance/expire',
    destination: '/api/action-execute?transport=marketplace-payment-expiry',
  });
});
