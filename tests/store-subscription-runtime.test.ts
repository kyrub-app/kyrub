import assert from 'node:assert/strict';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import test from 'node:test';

const service = readFileSync('server/payments/storeSubscriptionService.ts', 'utf8');
const billingContract = readFileSync('shared/storeSubscriptionBilling.ts', 'utf8');
const gateway = readFileSync('api/plan-control.ts', 'utf8');
const client = readFileSync('src/utils/storeSubscription.ts', 'utf8');
const ordinaryWebhook = readFileSync('server/payments/mercadoPagoWebhook.ts', 'utf8');
const platformBilling = readFileSync('server/admin/paidPlanSubscriptionService.ts', 'utf8');

const collectApiFunctions = (directory: string): string[] =>
  readdirSync(directory).flatMap(name => {
    const path = join(directory, name);
    return statSync(path).isDirectory()
      ? collectApiFunctions(path)
      : path.endsWith('.ts')
        ? [path]
        : [];
  });

test('merchant subscription checkout trusts canonical catalog and merchant recipient authority, not browser pricing', () => {
  assert.match(service, /stores\/\$\{storeId\}\/products\/\$\{productId\}/);
  assert.match(service, /parseProductSaleModality\(data\.saleModality\)/);
  assert.match(service, /Math\.round\(price \* 100\)/);
  assert.match(service, /context: 'store_subscription'/);
  assert.match(service, /recipientKind !== 'merchant_store'/);
  assert.match(service, /recipient\.credentialScopeId/);
  assert.match(service, /mercadoPagoStoreRequest<MpPreapproval>/);
  assert.match(service, /'\/preapproval'/);
  assert.match(service, /notification_url: providerWebhookUrl\(\)/);

  assert.doesNotMatch(client, /amountMinor|transaction_amount|currency_id|frequency_type|credentialScopeId|externalAccountId|provider:/);
  assert.match(client, /storeId: input\.storeId\.trim\(\)/);
  assert.match(client, /productId: input\.productId\.trim\(\)/);
});

test('recurring state is driven by the newest provider invoice and exposes payment due separately from active', () => {
  assert.match(billingContract, /'payment_due'/);
  assert.match(service, /authorized_payments\/search\?preapproval_id=/);
  assert.match(service, /let latest: ProviderInvoiceSnapshot \| null = null/);
  assert.match(service, /occurredTime < latestTime/);
  assert.match(service, /paymentStatus\(payment\.status, payment\.status_detail\)/);
  assert.match(service, /latestInvoice\?\.paymentStatus === 'approved'/);
  assert.match(service, /subscription\.activatedAt \? 'payment_due' : 'pending'/);
  assert.match(service, /paymentConfirmedAt:/);
});

test('cancellation is provider-confirmed and releases the buyer-product slot for a future resubscription', () => {
  assert.match(service, /JSON\.stringify\(\{ status: 'canceled' \}\)/);
  assert.match(service, /STORE_SUBSCRIPTION_CANCEL_NOT_CONFIRMED/);
  assert.match(service, /releaseCheckoutSlotIfCancelled/);
  assert.match(service, /state: 'cancelled'/);
  assert.match(service, /existing && existing\.state !== 'cancelled'/);
  assert.match(service, /CREATION_LOCK_MS/);
});

test('merchant subscription webhook verifies HMAC before routing and re-reads provider resources with merchant OAuth', () => {
  const signature = service.indexOf('await verifyMercadoPagoWebhookSignature');
  const accountLookup = service.indexOf('const account = await loadAccountBinding');
  assert.ok(signature >= 0 && accountLookup > signature);
  assert.match(service, /eventType !== 'subscription_preapproval'/);
  assert.match(service, /eventType !== 'subscription_authorized_payment'/);
  assert.match(service, /authorized_payments\/\$\{encodeURIComponent\(dataId\)\}/);
  assert.match(service, /binding\.credentialScopeId !== account\.credentialScopeId/);
  assert.match(service, /reconcileByProviderBinding/);
  assert.match(service, /collector_id/);
});

test('plan-control multiplexes merchant subscriptions without altering the ordinary Pix webhook or platform billing authority', () => {
  assert.match(gateway, /merchant\.subscription\.webhook/);
  assert.match(gateway, /merchant\.subscription\.checkout/);
  assert.match(gateway, /merchant\.subscription\.state/);
  assert.match(gateway, /merchant\.subscription\.reconcile/);
  assert.match(gateway, /merchant\.subscription\.cancel/);
  assert.match(gateway, /processStoreSubscriptionMercadoPagoWebhook/);
  assert.doesNotMatch(ordinaryWebhook, /storeSubscription|merchant\.subscription/);
  assert.match(platformBilling, /KYRUB_BILLING_MERCADO_PAGO_ACCESS_TOKEN/);
  assert.doesNotMatch(platformBilling, /mercadoPagoStoreRequest/);
});

test('merchant subscription runtime does not add another Vercel serverless function', () => {
  const functions = collectApiFunctions('api');
  assert.ok(functions.length <= 11, `Expected at most 11 API functions, found ${functions.length}`);
  assert.ok(functions.includes('api/plan-control.ts'));
  assert.ok(functions.includes('api/action-execute.ts'));
});
