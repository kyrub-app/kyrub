import assert from 'node:assert/strict';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import test from 'node:test';
import './store-subscriber-registry.test';

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
  assert.match(service, /Math\.abs\(priceMinor - Math\.round\(priceMinor\)\) <= 1e-7/);
  assert.match(service, /Number\.isSafeInteger\(Math\.round\(priceMinor\)\)/);
  assert.match(service, /STORE_SUBSCRIPTION_PLATFORM_PLAN_REQUIRES_OFFICIAL_CHECKOUT/);
  assert.match(service, /typeof price === 'number'/);
  assert.match(service, /STORE_SUBSCRIPTION_CONTRACT_CHECKOUT_REQUIRED/);
  assert.match(service, /payload\.selectedMonths !== undefined \|\| payload\.paymentTerms !== undefined/);
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

test('contract quote uses authenticated existing gateway and persisted merchant catalog without charging', () => {
  assert.match(gateway, /case 'merchant\.subscription\.quote'/);
  assert.match(gateway, /await authenticateConsultantRequest\(authorization\)/);
  assert.match(gateway, /await quotePersistedMerchantSubscription\(/);
  assert.match(client, /post\('merchant\.subscription\.quote'/);
  const quote = readFileSync('server/payments/persistedMerchantSubscriptionQuote.ts', 'utf8');
  assert.match(quote, /requirePublishedTenant: true/);
  assert.match(quote, /authoritativeMonthlyPriceMinor: Math\.round\(price \* 100\)/);
  assert.match(quote, /persistedOffers: data\.contractDiscounts/);
  assert.doesNotMatch(quote, /mercadoPagoStoreRequest|preapproval|createPayment/);
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

test('legacy recurring checkout refuses persisted contract offers even when client omits terms', () => {
  const service = readFileSync('server/payments/storeSubscriptionService.ts', 'utf8');
  assert.match(service, /persistedProduct\.data\(\)\?\.contractDiscounts !== undefined/);
  assert.match(service, /STORE_SUBSCRIPTION_CONTRACT_CHECKOUT_REQUIRED/);
  assert.match(service, /payload\.selectedMonths !== undefined/);
});

test('subscription quote gateway validates input before consulting canonical catalog', () => {
  const gateway = readFileSync('api/plan-control.ts', 'utf8');
  const start = gateway.indexOf("case 'merchant.subscription.quote'");
  const end = gateway.indexOf("case 'merchant.subscription.checkout'", start);
  assert.ok(start >= 0 && end > start);
  const handler = gateway.slice(start, end);
  assert.match(handler, /typeof body\.storeId !== 'string'/);
  assert.match(handler, /typeof body\.productId !== 'string'/);
  assert.match(handler, /\[1, 3, 6, 12\]\.includes/);
  assert.match(handler, /INVALID_SUBSCRIPTION_QUOTE_REQUEST/);
  assert.ok(handler.indexOf('INVALID_SUBSCRIPTION_QUOTE_REQUEST') < handler.indexOf('await quotePersistedMerchantSubscription'));
});


test('official Kyrub plan mapping cannot be billed through the merchant preapproval endpoint', () => {
  assert.match(service, /kyrub_admin\/control_plane\/official_plan_products\/\$\{product\.id\}/);
  assert.match(service, /OFFICIAL_PLAN_REQUIRES_PLATFORM_CHECKOUT/);
  const guard = service.indexOf('if (officialPlanMapping.exists)');
  const recipient = service.indexOf("context: 'store_subscription'", guard);
  const provider = service.indexOf("'/preapproval'", guard);
  assert.ok(guard >= 0 && recipient > guard && provider > recipient,
    'Privileged official-plan check must run before merchant recipient and provider creation');
});

test('cart routes eligible monthly subscriptions through the canonical platform-or-merchant gateway', () => {
  const cart = readFileSync('src/components/modals/B2CCartDrawerApprovalBase.tsx', 'utf8');
  assert.match(cart, /createCatalogSubscriptionCheckout\(/);
  assert.match(cart, /cart\.length !== 1 \|\| subscriptions\[0\]\.quantity !== 1/);
  assert.match(cart, /subscriptions\[0\]\.product\.contractDiscounts !== undefined/);
  assert.match(cart, /subscriptionMonths !== 1/);
  assert.match(cart, /hasSubscriptionCartItem && !canStartLegacyMonthlySubscription/);
  assert.match(cart, /window\.location\.assign\(checkoutUrl\.toString\(\)\)/);
  assert.match(gateway, /case 'catalog\.subscription\.checkout'/);
  assert.match(gateway, /route\.kind === 'platform-plan'/);
  assert.match(gateway, /createOwnPaidPlanCheckout\(authorization, route\.plan\)/);
  assert.match(gateway, /createAuthorizedStoreSubscription\(authorization, body\)/);
});


test('unified subscription checkout authenticates and resolves persisted official routing before payment', () => {
  const start = gateway.indexOf("case 'catalog.subscription.checkout'");
  const end = gateway.indexOf("case 'merchant.subscription.quote'", start);
  assert.ok(start >= 0 && end > start);
  const handler = gateway.slice(start, end);
  assert.match(handler, /Object\.keys\(body\)\.some\(/);
  assert.match(handler, /SUBSCRIPTION_CONTRACT_CHECKOUT_REQUIRED/);
  assert.match(handler, /await authenticateConsultantRequest\(authorization\)/);
  assert.match(handler, /await resolvePersistedProductCheckoutRoute\(/);
  assert.match(handler, /allowMerchantSubscription: true/);
  assert.match(handler, /route\.kind === 'platform-plan'/);
  assert.match(handler, /createOwnPaidPlanCheckout\(authorization, route\.plan\)/);
  assert.match(handler, /route\.kind === 'free-plan'/);
  assert.match(handler, /createAuthorizedStoreSubscription\(authorization, body\)/);
  assert.ok(handler.indexOf('await authenticateConsultantRequest') < handler.indexOf('await resolvePersistedProductCheckoutRoute'));
});


test('unified checkout fails closed on official contract discounts, price mismatch and non-subscription products', () => {
  const lookup = readFileSync('server/admin/officialPlanProductLookup.ts', 'utf8');
  assert.match(lookup, /OFFICIAL_PLAN_CONTRACT_CHECKOUT_REQUIRED/);
  assert.match(lookup, /data\.contractDiscounts !== undefined/);
  assert.match(lookup, /OFFICIAL_PLAN_PRICE_MISMATCH/);
  assert.match(lookup, /Math\.round\(productPrice \* 100\) !== Math\.round\(activePlan\.monthlyPriceBRL \* 100\)/);
  assert.match(lookup, /PRODUCT_NOT_SUBSCRIPTION/);
  assert.match(lookup, /parsedModality\.mode !== 'subscription'/);
  const priceGuard = lookup.indexOf('OFFICIAL_PLAN_PRICE_MISMATCH');
  const route = lookup.indexOf('return resolveCheckoutBillingRoute');
  assert.ok(priceGuard >= 0 && route > priceGuard, 'Price validation must precede billing routing');
});


test('official plan billing uses control-plane price and cannot silently charge a different storefront amount', () => {
  const lookup = readFileSync('server/admin/officialPlanProductLookup.ts', 'utf8');
  const guard = lookup.indexOf('OFFICIAL_PLAN_PRICE_MISMATCH');
  const route = lookup.indexOf('return resolveCheckoutBillingRoute');
  assert.ok(guard >= 0 && route > guard);
  assert.match(lookup, /Math\.round\(productPrice \* 100\) !== Math\.round\(activePlan\.monthlyPriceBRL \* 100\)/);
  assert.match(lookup, /mappingData\.canonicalStoreId !== seller\.canonicalStoreId/);
  assert.match(lookup, /mappingData\.status !== 'active'/);
  assert.match(lookup, /data\.contractDiscounts !== undefined/);
  assert.match(lookup, /OFFICIAL_PLAN_CONTRACT_CHECKOUT_REQUIRED/);
});


test('unified subscription checkout authenticates and resolves persisted official plan mapping before billing', () => {
  const route = readFileSync('server/admin/officialPlanProductLookup.ts', 'utf8');
  assert.match(gateway, /case 'catalog\.subscription\.checkout'/);
  const start = gateway.indexOf("case 'catalog.subscription.checkout'");
  const end = gateway.indexOf("case 'merchant.subscription.quote'", start);
  assert.ok(start >= 0 && end > start);
  const handler = gateway.slice(start, end);
  assert.match(handler, /Object\.keys\(body\)\.some\(key => key !== 'storeId' && key !== 'productId'\)/);
  assert.match(handler, /await authenticateConsultantRequest\(authorization\)/);
  assert.match(handler, /resolvePersistedProductCheckoutRoute\(/);
  assert.match(handler, /allowMerchantSubscription: true/);
  assert.match(handler, /route\.kind === 'platform-plan'/);
  assert.match(handler, /createOwnPaidPlanCheckout\(authorization, route\.plan\)/);
  assert.match(handler, /route\.kind === 'free-plan'/);
  assert.match(handler, /createAuthorizedStoreSubscription\(authorization, body\)/);
  assert.match(route, /official_plan_products\/\$\{productId\}/);
  assert.match(route, /OFFICIAL_PLAN_PRICE_MISMATCH/);
  assert.match(route, /PRODUCT_NOT_SUBSCRIPTION/);
  assert.match(client, /catalog\.subscription\.checkout/);
});


test('unified catalog checkout selects server-authoritative official plan billing', () => {
  const start = gateway.indexOf("case 'catalog.subscription.checkout'");
  const end = gateway.indexOf("case 'merchant.subscription.quote'", start);
  assert.ok(start >= 0 && end > start);
  const handler = gateway.slice(start, end);
  assert.match(handler, /await authenticateConsultantRequest\(authorization\)/);
  assert.match(handler, /resolvePersistedProductCheckoutRoute\(/);
  assert.match(handler, /route\.kind === 'platform-plan'/);
  assert.match(handler, /createOwnPaidPlanCheckout\(authorization, route\.plan\)/);
  assert.match(handler, /route\.kind === 'free-plan'/);
  assert.match(handler, /FREE_PLAN_CHECKOUT_NOT_REQUIRED/);
  assert.match(handler, /createAuthorizedStoreSubscription\(authorization, body\)/);
  assert.match(handler, /Object\.keys\(body\)\.some/);
  assert.ok(handler.indexOf('await authenticateConsultantRequest') < handler.indexOf('resolvePersistedProductCheckoutRoute'));
});


test('unified catalog subscription route rejects merchant term offers before any provider checkout', () => {
  const route = readFileSync('server/admin/officialPlanProductLookup.ts', 'utf8');
  assert.match(route, /MERCHANT_CONTRACT_CHECKOUT_REQUIRED/);
  assert.match(route, /input\.allowMerchantSubscription &&\s*parsedModality\.mode === 'subscription' && data\.contractDiscounts !== undefined/);
  assert.ok(route.indexOf('MERCHANT_CONTRACT_CHECKOUT_REQUIRED') < route.indexOf('return resolveCheckoutBillingRoute('));
});
