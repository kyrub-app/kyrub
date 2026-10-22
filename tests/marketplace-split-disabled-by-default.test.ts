import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import {
  buildStoreCommercialRecipientAuthority,
  buildPlatformPlanRecipientAuthority,
} from '../shared/commercialRecipientAuthority';

const read = (path: string) => readFileSync(path, 'utf8');

test('Model B: merchant owns store sale, platform owns own subscription', () => {
  const sale = buildStoreCommercialRecipientAuthority({
    context: 'store_sale', canonicalStoreId: 'store-owner',
    ownerUserId: 'store-owner', credentialScopeId: 'store-owner',
    externalAccountId: 'seller-mp-id',
  });
  const billing = buildPlatformPlanRecipientAuthority();
  assert.equal(sale.recipientKind, 'merchant_store');
  assert.equal(sale.credentialAuthority, 'store_oauth_vault');
  assert.equal(sale.externalAccountId, 'seller-mp-id');
  assert.equal(sale.platformFeeMode, 'separate');
  assert.equal(billing.recipientKind, 'platform');
  assert.equal(billing.credentialAuthority, 'platform_billing');
});

test('Marketplace split is planned, but not active on any storefront Pix checkout', () => {
  const provider = read('server/payments/mercadoPagoStoreScopedProvider.ts');
  const bridge = read('server/payments/mercadoPagoCheckoutBridge.ts');
  assert.match(provider, /context: 'store_sale'/);
  assert.match(bridge, /createStoreScopedMercadoPagoMarketplacePix/);
  assert.doesNotMatch(provider, /application_fee\s*:|marketplace_fee\s*:|splits\s*:/);
  assert.doesNotMatch(bridge, /application_fee\s*:|marketplace_fee\s*:|splits\s*:/);
  assert.doesNotMatch(bridge, /createMercadoPagoPixPayment\(/);
});

test('Explicit roadmap gates marketplace split 1:1 separately from assisted 1:N', () => {
  const docs = read('docs/finance/marketplace-merchant-pix-cutover-isolated.md');
  assert.match(docs, /Split 1:1/);
  assert.match(docs, /DESATIVADO/);
  assert.match(docs, /application_fee/);
  assert.match(docs, /marketplace_fee/);
  assert.match(docs, /Split 1:N/);
  assert.match(docs, /carteira assessorada/);
  assert.match(docs, /assinatura do plano do próprio Kyrub/i);
  assert.match(docs, /Pix histórico já emitido/);
});
