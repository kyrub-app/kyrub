import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const bridge = readFileSync('src/components/store/TablePixCanonicalCheckoutBridge.tsx', 'utf8');

test('table Pix bridge never submits a client-selected monetary amount', () => {
  assert.doesNotMatch(bridge, /selectedPaymentTotal|amount\s*:/);
});
