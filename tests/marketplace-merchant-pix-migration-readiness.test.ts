import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';

const source = (path: string) => readFileSync(path, 'utf8');

test('readiness remains owner-only and read-only; metadata is not a live financial guarantee', () => {
  const router = source('server/integrations/mercadoPagoStoreRouter.ts');
  const statusRoute = router.split("router.get('/:storeId/status', async")[1]
    ?.split("router.post('/:storeId/authorize'")[0] ?? '';
  assert.match(statusRoute, /await requireOwner\(request\.get\('authorization'\) \?\? '', storeId\)/);
  assert.match(statusRoute, /await getMercadoPagoStoreConnectionStatus\(storeId\)/);
  assert.match(statusRoute, /marketplacePixPreparation: mercadoPagoMerchantPixPreparationState\(\{/);
  assert.doesNotMatch(statusRoute, /mercadoPagoStoreRequest|beginMercadoPagoStoreAuthorization|createStoreScopedMercadoPagoMarketplacePix|runTransaction/);
  const ui = source('src/components/store/MercadoPagoReceivablesBridge.tsx');
  assert.match(ui, /data-kyrub-mp-store-pix-readiness/);
  assert.match(ui, /nova emissão Pix desta loja ainda não foi liberada/);
  assert.match(ui, /Loja incluída na liberação do novo Pix/);
  assert.doesNotMatch(ui, /criar Pix automaticamente/i);
});

test('a live merchant Pix cannot use the platform token as fallback for an unconnected store', () => {
  const bridge = source('server/payments/mercadoPagoCheckoutBridge.ts');
  const provider = source('server/payments/mercadoPagoStoreScopedProvider.ts');
  assert.match(bridge, /createStoreScopedMercadoPagoMarketplacePix\(/);
  assert.doesNotMatch(bridge, /createMercadoPagoPixPayment\(/);
  assert.match(provider, /resolveCommercialRecipientAuthority\(/);
  assert.match(provider, /validateMercadoPagoStoreConnection\(credentialScopeId\)/);
  assert.match(provider, /mercadoPagoStoreRequest<MercadoPagoPayment>\(credentialScopeId/);
  assert.doesNotMatch(provider, /MERCADO_PAGO_ACCESS_TOKEN|application_fee|marketplace_fee/);
  assert.match(bridge, /binding\s*\? await getStoreScopedMercadoPagoPixCheckout\(intent\.providerIntentId\)/);
  assert.match(bridge, /await getMercadoPagoPixCheckout\(intent\.providerIntentId\)/);
});
