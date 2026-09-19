import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const bridge = readFileSync(
  'src/components/store/TablePixCanonicalCheckoutBridge.tsx',
  'utf8'
);
const financialPanel = readFileSync(
  'src/components/store/ServiceLocationFinancialContextPanel.tsx',
  'utf8'
);

test('table Pix reuses the existing local canonical payment surface', () => {
  assert.match(bridge, /ServiceLocationFinancialContextPanel/);
  assert.match(financialPanel, /loadPendingLocalPayment/);
  assert.match(financialPanel, /createLocalPaymentIntent/);
  assert.match(financialPanel, /attachLocalMercadoPagoPix/);
});

test('table Pix bridge cannot write operational settlement itself', () => {
  assert.doesNotMatch(bridge, /registerTablePayment/);
  assert.doesNotMatch(bridge, /paidQuantity\s*[:=]/);
  assert.doesNotMatch(bridge, /paymentStatus\s*[:=]/);
  assert.doesNotMatch(bridge, /setDoc|updateDoc|runTransaction/);
});

test('provider confirmation remains outside the table bridge', () => {
  assert.match(financialPanel, /Pix aguardando confirmação/);
  assert.match(financialPanel, /webhook verificado do provedor/);
  assert.doesNotMatch(bridge, /status:\s*['"]paid['"]/);
});
