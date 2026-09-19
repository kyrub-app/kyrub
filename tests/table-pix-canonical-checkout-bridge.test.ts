import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const bridge = readFileSync(
  'src/components/store/TablePixCanonicalCheckoutBridge.tsx',
  'utf8'
);
const main = readFileSync('src/main.tsx', 'utf8');
const legacyWorkspace = readFileSync(
  'src/components/customer/TableServiceWorkspace.tsx',
  'utf8'
);

test('table Pix bridge is mounted globally beside the existing staff workspace', () => {
  assert.match(main, /TablePixCanonicalCheckoutBridge/);
  assert.match(main, /<TablePixCanonicalCheckoutBridge \/>/);
});

test('selecting Pix opens the canonical checkout instead of inventing another payment engine', () => {
  assert.match(bridge, /label === 'pix'/);
  assert.match(bridge, /ServiceLocationFinancialContextPanel/);
  assert.match(bridge, /subscribeToStoreCustomerOrders/);
  assert.match(bridge, /getActiveTableOrders/);
  assert.doesNotMatch(bridge, /registerTablePayment/);
  assert.doesNotMatch(bridge, /paidQuantity\s*[:=]/);
  assert.doesNotMatch(bridge, /paymentStatus\s*[:=]/);
});

test('legacy Register payment click is stopped while Pix remains selected', () => {
  assert.match(bridge, /label === 'registrar pagamento'/);
  assert.match(bridge, /pixIsSelected\(account\)/);
  assert.match(bridge, /event\.preventDefault\(\)/);
  assert.match(bridge, /event\.stopPropagation\(\)/);
  assert.match(bridge, /event\.stopImmediatePropagation\(\)/);
});

test('canonical Pix modal explains that QR creation does not settle the table', () => {
  assert.match(bridge, /Gerar QR Code sem baixar a mesa antes do pagamento/);
  assert.match(bridge, /não altera `paidQuantity`/);
  assert.match(bridge, /webhook verificado do provedor/);
});

test('historical staff workspace still keeps non-PSP manual methods while the bridge guards Pix', () => {
  assert.match(legacyWorkspace, /\['cash', 'pix', 'card', 'other'\]/);
  assert.match(legacyWorkspace, /registerTablePayment/);
});
