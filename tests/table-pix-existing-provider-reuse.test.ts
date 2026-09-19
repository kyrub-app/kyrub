import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const bridge = readFileSync(
  'src/components/store/TablePixCanonicalCheckoutBridge.tsx',
  'utf8'
);
const panel = readFileSync(
  'src/components/store/ServiceLocationFinancialContextPanel.tsx',
  'utf8'
);

test('table bridge delegates QR generation to the existing Mercado Pago local Pix path', () => {
  assert.match(bridge, /ServiceLocationFinancialContextPanel/);
  assert.match(panel, /attachLocalMercadoPagoPix/);
  assert.doesNotMatch(bridge, /mercado-pago-pix|MercadoPago|providerPaymentId/);
});
