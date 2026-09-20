import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const source = async (path: string): Promise<string> =>
  readFile(new URL(`../${path}`, import.meta.url), 'utf8');

test('local Pix adapter uses store-scoped Mercado Pago authority', async () => {
  const adapter = await source('server/payments/paymentProviderAdapter.ts');
  assert.match(adapter, /createStoreScopedMercadoPagoLocalPix/);
  assert.match(adapter, /getStoreScopedMercadoPagoPixCheckout/);
  assert.doesNotMatch(adapter, /createMercadoPagoPixPayment/);
});

test('store Mercado Pago OAuth uses authorization code, state and PKCE', async () => {
  const oauth = await source('server/integrations/mercadoPagoStoreOauthService.ts');
  assert.match(oauth, /auth\.mercadopago\.com\/authorization/);
  assert.match(oauth, /grant_type: 'authorization_code'/);
  assert.match(oauth, /code_challenge_method', 'S256'/);
  assert.match(oauth, /integrationOauthStates\/mercado_pago__/);
  assert.match(oauth, /MERCADO_PAGO_STORE_NOT_CONNECTED/);
});

test('store payment webhook resolves server-owned provider binding before merchant token', async () => {
  const provider = await source('server/payments/mercadoPagoStoreScopedProvider.ts');
  const webhook = await source('server/payments/mercadoPagoWebhook.ts');
  assert.match(provider, /loadMercadoPagoPaymentProviderBinding/);
  assert.match(provider, /binding\.legacyStoreId/);
  assert.match(provider, /verifyMercadoPagoWebhookSignature/);
  assert.match(webhook, /verifiedStoreScopedMercadoPagoPaymentEvent/);
});

test('receivables integration is mounted separately from store identity settings', async () => {
  const bridge = await source('src/components/store/MercadoPagoReceivablesBridge.tsx');
  const main = await source('src/main.tsx');
  assert.match(bridge, /Recebimentos/);
  assert.match(bridge, /Conectar Mercado Pago/);
  assert.match(bridge, /mercado-livre-integration-card/);
  assert.match(main, /MercadoPagoReceivablesBridge/);
});
