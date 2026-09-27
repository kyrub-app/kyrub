import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import {
  buildPlatformPlanRecipientAuthority,
  buildStoreCommercialRecipientAuthority,
} from '../shared/commercialRecipientAuthority';

const resolverSource = readFileSync(
  'server/payments/commercialRecipientAuthorityService.ts',
  'utf8'
);
const storeProviderSource = readFileSync(
  'server/payments/mercadoPagoStoreScopedProvider.ts',
  'utf8'
);
const paidPlanSource = readFileSync(
  'server/admin/paidPlanSubscriptionService.ts',
  'utf8'
);

test('store sales and store subscriptions belong to the merchant store', () => {
  for (const context of ['store_sale', 'store_subscription'] as const) {
    const authority = buildStoreCommercialRecipientAuthority({
      context,
      canonicalStoreId: 'store-canonical-a',
      ownerUserId: 'owner-a',
      credentialScopeId: 'owner-a',
      externalAccountId: 'mp-account-a',
    });

    assert.equal(authority.context, context);
    assert.equal(authority.recipientKind, 'merchant_store');
    assert.equal(authority.beneficiaryPrincipalId, 'store:store-canonical-a');
    assert.equal(authority.credentialAuthority, 'store_oauth_vault');
    assert.equal(authority.credentialScopeId, 'owner-a');
    assert.equal(authority.externalAccountId, 'mp-account-a');
    assert.equal(authority.platformFeeMode, 'separate');
  }
});

test('store authority rejects a credential scope that belongs to another principal', () => {
  assert.throws(
    () =>
      buildStoreCommercialRecipientAuthority({
        context: 'store_subscription',
        canonicalStoreId: 'store-canonical-a',
        ownerUserId: 'owner-a',
        credentialScopeId: 'owner-b',
        externalAccountId: 'mp-account-b',
      }),
    /STORE_SCOPE_MISMATCH/
  );
});

test('Kyrub plan subscriptions remain platform billing and never a merchant-store receipt', () => {
  const authority = buildPlatformPlanRecipientAuthority();

  assert.equal(authority.context, 'platform_plan_subscription');
  assert.equal(authority.recipientKind, 'platform');
  assert.equal(authority.beneficiaryPrincipalId, 'platform:kyrub');
  assert.equal(authority.credentialAuthority, 'platform_billing');
  assert.equal(authority.credentialScopeId, 'kyrub_billing');
  assert.equal(authority.externalAccountId, '');
  assert.equal(authority.canonicalStoreId, '');
});

test('recipient account is resolved server-side from canonical store identity', () => {
  assert.match(resolverSource, /adminDb\.doc\(`stores\/\$\{canonicalStoreId\}`\)\.get\(\)/);
  assert.match(resolverSource, /loadMercadoPagoStoreConnectionMetadata/);
  assert.match(resolverSource, /credentialScopeId !== ownerUserId/);
  assert.match(resolverSource, /context === 'platform_plan_subscription'/);
  assert.doesNotMatch(resolverSource, /input\.externalAccountId/);
  assert.doesNotMatch(resolverSource, /input\.provider/);
  assert.doesNotMatch(resolverSource, /input\.credentialScopeId/);
});

test('ordinary store Pix uses store-sale authority before opening the provider payment', () => {
  assert.match(storeProviderSource, /resolveCommercialRecipientAuthority/);
  assert.match(storeProviderSource, /context: 'store_sale'/);
  assert.match(storeProviderSource, /canonicalStoreId: input\.intent\.storeId/);
  assert.match(storeProviderSource, /recipientAuthority\.credentialScopeId/);
  assert.match(storeProviderSource, /mercadoPagoStoreRequest<MercadoPagoPayment>\(credentialScopeId/);
});

test('paid Pro and Business keep the dedicated Kyrub billing credential', () => {
  assert.match(paidPlanSource, /KYRUB_BILLING_MERCADO_PAGO_ACCESS_TOKEN/);
  assert.match(paidPlanSource, /KYRUB_BILLING_MERCADO_PAGO_WEBHOOK_SECRET/);
  assert.doesNotMatch(paidPlanSource, /mercadoPagoStoreRequest/);
  assert.doesNotMatch(paidPlanSource, /loadMercadoPagoStoreConnectionMetadata/);
});
