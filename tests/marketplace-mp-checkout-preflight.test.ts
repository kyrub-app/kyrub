import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';

const source = (path: string): string => readFileSync(path, 'utf8');

test('MP connection preflight checks authenticated owner, live account and canonical checkout authority', () => {
  const router = source('server/integrations/mercadoPagoStoreRouter.ts');
  const preflight = router.split("router.post('/:storeId/validate', async")[1]
    ?.split("router.post('/:storeId/disconnect'")[0] ?? '';
  assert.match(preflight, /await requireOwner\(request\.get\('authorization'\) \?\? '', storeId\)/);
  assert.match(preflight, /await validateMercadoPagoStoreConnection\(storeId\)/);
  assert.match(preflight, /await resolveCommercialRecipientAuthority\(\{/);
  assert.match(preflight, /context: 'store_sale'/);
  assert.match(preflight, /canonicalStoreId: storeId/);
  assert.match(preflight, /authority\.recipientKind !== 'merchant_store'/);
  assert.match(preflight, /authority\.credentialAuthority !== 'store_oauth_vault'/);
  assert.match(preflight, /authority\.ownerUserId !== storeId/);
  assert.match(preflight, /authority\.credentialScopeId !== storeId/);
  assert.match(preflight, /authority\.externalAccountId !== externalAccountId/);
  assert.match(preflight, /authority\.platformFeeMode !== 'separate'/);
  assert.match(preflight, /recipientPreflightReady: true/);
  assert.match(preflight, /checkoutActivated: false/);
  assert.doesNotMatch(preflight, /createMercadoPagoPixPayment\(|createStoreScopedMercadoPagoMarketplacePix\(|\.runTransaction\(|transaction\.set\(|transaction\.update\(/);
});

test('OAuth validation reads live MP profile, not stale connection metadata alone', () => {
  const oauth = source('server/integrations/mercadoPagoStoreOauthService.ts');
  const verify = oauth.split('export const validateMercadoPagoStoreConnection = async')[1]
    ?.split('export const getMercadoPagoStoreConnectionStatus')[0] ?? '';
  assert.match(verify, /mercadoPagoStoreRequest<\{ id\?: unknown \}>\(storeId, '\/users\/me'\)/);
  assert.match(verify, /secret\.externalAccountId !== externalAccountId/);
  assert.doesNotMatch(verify, /\/v1\/payments|createMercadoPagoPixPayment/);
});

test('owner-only preflight shows separate readiness, no Pix confirmation claim', () => {
  const panel = source('src/components/store/MercadoPagoReceivablesBridge.tsx');
  const client = source('src/utils/mercadoPagoStoreConnection.ts');
  assert.match(client, /recipientPreflightReady: true; checkoutActivated: false; externalAccountId: string/);
  assert.match(panel, /await validateMercadoPagoStoreConnection\(user\)/);
  assert.match(panel, /setVerifiedCheckoutAccountId\(result\.externalAccountId\)/);
  assert.match(panel, /data-kyrub-mp-checkout-preflight="verified"/);
  assert.match(panel, /O pagamento e o webhook precisam de teste controlado após a PR #949/);
  assert.match(panel, /Nenhum Pix foi criado/);
  assert.match(panel, /Pré-validar conta recebedora/);
  assert.match(panel, /setVerifiedCheckoutAccountId\(''\)/);
  assert.doesNotMatch(panel, /createMercadoPagoPixPayment|application_fee|marketplace_fee/);
});


test('fixed homologation preflight does not activate legacy storefront checkout or split', () => {
  const bridge = source('server/payments/mercadoPagoCheckoutBridge.ts');
  const provider = source('server/payments/mercadoPagoStoreScopedProvider.ts');
  const panel = source('src/components/store/MercadoPagoReceivablesBridge.tsx');
  assert.match(bridge, /createMercadoPagoPixPayment/);
  assert.doesNotMatch(bridge, /createStoreScopedMercadoPagoMarketplacePix/);
  assert.doesNotMatch(provider, /application_fee|marketplace_fee/);
  assert.match(panel, /checkout Pix da vitrine ainda não foi alterado/);
  assert.match(panel, /disabled=\{busy \|\| !status\?\.platformConfigured \|\| !status\?\.oauthOperationsAllowed\}/);
});


test('preview cannot mutate production OAuth tokens or disconnect the merchant', () => {
  const router = source('server/integrations/mercadoPagoStoreRouter.ts');
  const panel = source('src/components/store/MercadoPagoReceivablesBridge.tsx');
  const client = source('src/utils/mercadoPagoStoreConnection.ts');
  assert.match(router, /process\.env\.VERCEL_ENV === 'production'/);
  assert.match(router, /MERCADO_PAGO_OAUTH_PREVIEW_READONLY/);
  assert.match(router, /oauthOperationsAllowed: oauthOperationsAllowed\(\)/);
  for (const route of ["router.get('/callback'", "router.post('/:storeId/authorize'", "router.post('/:storeId/validate'", "router.post('/:storeId/disconnect'"]) {
    const section = router.split(route)[1]?.split("\n  });")[0] ?? '';
    assert.match(section, /requireOauthOperationsAllowed\(\)/);
  }
  assert.match(client, /oauthOperationsAllowed: boolean/);
  assert.match(panel, /data-kyrub-mp-preview-readonly="true"/);
  assert.match(panel, /status\?\.oauthOperationsAllowed && \(/);
  assert.match(panel, /!status\?\.oauthOperationsAllowed/);
});
