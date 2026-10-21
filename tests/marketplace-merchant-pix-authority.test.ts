import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import {
  buildStoreCommercialRecipientAuthority,
  buildPlatformPlanRecipientAuthority,
} from '../shared/commercialRecipientAuthority';

const read = (file: string): string => readFileSync(file, 'utf8');

test('store sales and platform subscriptions have disjoint payment beneficiaries', () => {
  const store = buildStoreCommercialRecipientAuthority({
    context: 'store_sale',
    canonicalStoreId: 'owner-1',
    ownerUserId: 'owner-1',
    credentialScopeId: 'owner-1',
    externalAccountId: 'collector-1',
  });
  const platform = buildPlatformPlanRecipientAuthority();
  assert.equal(store.credentialAuthority, 'store_oauth_vault');
  assert.equal(store.recipientKind, 'merchant_store');
  assert.equal(store.externalAccountId, 'collector-1');
  assert.equal(platform.credentialAuthority, 'platform_billing');
  assert.equal(platform.context, 'platform_plan_subscription');
  assert.notEqual(store.beneficiaryPrincipalId, platform.beneficiaryPrincipalId);
});

test('storefront approved marketplace Pix emits through store-owned OAuth only', () => {
  const bridge = read('server/payments/mercadoPagoCheckoutBridge.ts');
  const provider = read('server/payments/mercadoPagoStoreScopedProvider.ts');
  assert.match(bridge, /assertApprovedOperationalOrder/);
  assert.match(bridge, /freezeOrderCommercialSnapshot/);
  assert.match(bridge, /createStoreScopedMercadoPagoMarketplacePix\(/);
  assert.match(bridge, /const binding = await loadMercadoPagoPaymentProviderBinding\(intent\.providerIntentId\)/);
  assert.match(bridge, /getStoreScopedMercadoPagoPixCheckout/);
  assert.match(bridge, /getMercadoPagoPixCheckout/);
  assert.doesNotMatch(bridge, /createMercadoPagoPixPayment\(|isMercadoPagoPixRuntimeConfigured\(/);
  assert.match(provider, /resolveCommercialRecipientAuthority\(\{/);
  assert.match(provider, /context: 'store_sale'/);
  assert.match(provider, /mercadoPagoStoreRequest<MercadoPagoPayment>\(credentialScopeId, '\/v1\/payments'/);
  assert.match(provider, /if \(input\.verifyCollectorForMarketplace && clean\(payment\.collector_id\) !== recipientAuthority\.externalAccountId\)/);
  assert.match(provider, /throw new Error\('MERCADO_PAGO_STORE_PAYMENT_COLLECTOR_MISMATCH'\)/);
  assert.match(provider, /verifyCollectorForMarketplace: true/);
  assert.match(provider, /validateMercadoPagoStoreConnection\(credentialScopeId\)/);
  assert.match(provider, /process\.env\.VERCEL_ENV !== 'production'/);
  assert.match(provider, /MERCADO_PAGO_STORE_PIX_PRODUCTION_ONLY/);
  assert.match(provider, /saveMercadoPagoPaymentProviderBinding/);
  assert.ok(provider.indexOf("throw new Error('MERCADO_PAGO_STORE_PAYMENT_COLLECTOR_MISMATCH')") < provider.indexOf('await saveMercadoPagoPaymentProviderBinding('));
  assert.match(provider, /payerEmail: input\.intent\.orderDraft\.buyerEmail/);
  assert.match(provider, /kyrub_store_id: input\.intent\.storeId/);
  assert.match(provider, /kyrub_payment_id: input\.paymentId/);
  assert.match(provider, /'X-Idempotency-Key': input\.intent\.idempotencyKey/);
  assert.doesNotMatch(provider, /process\.env\.MERCADO_PAGO_ACCESS_TOKEN/);
});

test('unbound historical Pix can only be re-read, not minted with another account', () => {
  const bridge = read('server/payments/mercadoPagoCheckoutBridge.ts');
  const existing = bridge.split('if (intent.providerIntentId || payment.providerPaymentId) {')[1]
    ?.split('const refreshedAt')[0] ?? '';
  assert.match(existing, /binding\.canonicalStoreId !== intent\.storeId/);
  assert.match(existing, /binding\.paymentId !== payment\.id/);
  assert.match(existing, /binding\.paymentIntentId !== intent\.id/);
  assert.match(existing, /binding\s*\? await getStoreScopedMercadoPagoPixCheckout\(intent\.providerIntentId\)\s*:\s*await getMercadoPagoPixCheckout\(intent\.providerIntentId\)/);
  assert.doesNotMatch(existing, /createStoreScopedMercadoPagoMarketplacePix/);
});

test('merchant receiving is fail-closed when OAuth is absent, without platform fallback', () => {
  const authority = read('server/payments/commercialRecipientAuthorityService.ts');
  const checkout = read('server/payments/paymentIntentRouter.ts');
  assert.match(authority, /loadMercadoPagoStoreConnectionMetadata/);
  assert.match(authority, /COMMERCIAL_RECIPIENT_STORE_PAYMENT_NOT_CONNECTED/);
  assert.match(authority, /legacyMercadoPagoStoreIdFromPrimaryOwner\(canonicalStoreId, primaryStore\)/);
  assert.match(authority, /credentialScopeId !== ownerUserId/);
  assert.doesNotMatch(authority, /getMercadoPagoPayment|resolveMercadoPagoAccessToken/);
  assert.match(checkout, /message === 'COMMERCIAL_RECIPIENT_STORE_PAYMENT_NOT_CONNECTED'/);
  assert.match(checkout, /Nenhum pagamento foi criado/);
});

test('webhooks preserve signature authority without demanding platform Pix access token', () => {
  const mp = read('server/payments/mercadoPagoPixProvider.ts');
  const webhook = read('server/payments/mercadoPagoWebhook.ts');
  assert.match(mp, /isMercadoPagoWebhookRuntimeConfigured = async \(\): Promise<boolean> =>\s*Boolean\(await resolveMercadoPagoWebhookSecret\(\)\)/);
  assert.match(mp, /verifyMercadoPagoWebhookSignatureWithSecret/);
  assert.match(mp, /timingSafeEqual/);
  assert.match(webhook, /verifiedStoreScopedMercadoPagoPaymentEvent/);
  assert.match(webhook, /verifiedMercadoPagoPaymentEvent/);
  assert.match(webhook, /processVerifiedPaymentWebhook/);
  assert.match(webhook, /settleMarketplaceOperationalOrderAfterPayment/);
});
