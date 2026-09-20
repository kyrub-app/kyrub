import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const source = (path: string) => readFile(new URL(`../${path}`, import.meta.url), 'utf8');

test('merchant Mercado Pago setup stays inside store integrations without exposing platform credentials', async () => {
  const bridge = await source('src/components/store/MercadoPagoReceivablesBridge.tsx');

  assert.match(bridge, /Recebimentos/);
  assert.match(bridge, /Conectar minha conta Mercado Pago/);
  assert.match(bridge, /sua própria conta Mercado Pago/);
  assert.match(bridge, /temporariamente indisponível/);

  assert.doesNotMatch(bridge, /Client ID/);
  assert.doesNotMatch(bridge, /Client Secret/);
  assert.doesNotMatch(bridge, /Redirect URI/);
  assert.doesNotMatch(bridge, /adm\.kyrub/i);
});
