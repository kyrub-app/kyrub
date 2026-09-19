import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const bridge = readFileSync(
  'src/components/store/TablePixCanonicalCheckoutBridge.tsx',
  'utf8'
);

test('legacy register action is stopped before React receives it when Pix is selected', () => {
  const registerGuard = bridge.indexOf("label === 'registrar pagamento'");
  const stop = bridge.indexOf('event.stopImmediatePropagation()');
  const canonicalPanel = bridge.indexOf('<ServiceLocationFinancialContextPanel');
  assert.ok(registerGuard >= 0);
  assert.ok(stop > registerGuard);
  assert.ok(canonicalPanel > stop);
});
