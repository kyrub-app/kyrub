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
};

test('accepted unpaid marketplace orders keep an expiration-aware stock reservation', () => {
  assert.match(reservationSource, /activeExpiresAt/);
  assert.match(reservationSource, /paymentIntentId/);
  assert.match(reservationSource, /syncMarketplaceOrderInventoryReservationExpiry/);
  assert.match(reservationSource, /markMarketplaceOrderInventoryReservationPaymentConfirmed/);
  assert.match(checkoutSource, /effectiveExpiresAt/);
  assert.match(checkoutSource, /syncMarketplaceOrderInventoryReservationExpiry/);
  assert.match(webhookSource, /markMarketplaceOrderInventoryReservationPaymentConfirmed/);
});

test('expiry sweep reconciles Mercado Pago before releasing stock', () => {
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

test('expiry maintenance reuses action-execute and is protected by CRON_SECRET', () => {
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

  const cron = vercelConfig.crons?.find(
    entry => entry.path === '/api/payments/maintenance/expire'
  );
  assert.deepEqual(cron, {
    path: '/api/payments/maintenance/expire',
    schedule: '*/5 * * * *',
  });
});
