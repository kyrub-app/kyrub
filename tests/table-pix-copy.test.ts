import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const bridge = readFileSync(
  'src/components/store/TablePixCanonicalCheckoutBridge.tsx',
  'utf8'
);

test('table Pix copy does not imply settlement on QR generation', () => {
  assert.match(bridge, /não fecha a mesa/);
  assert.match(bridge, /não declara o pedido pago/);
  assert.match(bridge, /confirmação de pagamento continua pertencendo ao webhook verificado/);
});
