import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const intentService = readFileSync(
  'server/attendance/localPaymentIntentService.ts',
  'utf8'
);
const providerService = readFileSync(
  'server/attendance/localMercadoPagoPixService.ts',
  'utf8'
);

test('canonical Pix prefers service-location snapshots but accepts server-owned legacy table context', () => {
  for (const source of [intentService, providerService]) {
    assert.match(source, /parseServiceLocationSnapshot\(order\.serviceLocation\)/);
    assert.match(source, /if \(location\) return location\.kind === 'table' \? 'table' : 'pos'/);
    assert.match(source, /clean\(order\.tableCode, 80\)/);
    assert.match(source, /return 'table'/);
    assert.doesNotMatch(source, /request\.(tableCode|serviceLocation)/);
    assert.doesNotMatch(source, /request\.body\?\.(tableCode|serviceLocation)/);
  }
});

test('legacy table compatibility does not become a financial authority', () => {
  const combined = `${intentService}\n${providerService}`;
  assert.doesNotMatch(combined, /amount\s*=\s*order\.tableCode/);
  assert.doesNotMatch(combined, /buyerId\s*=\s*order\.tableCode/);
  assert.doesNotMatch(combined, /paymentStatus\s*:\s*'paid'/);
  assert.doesNotMatch(combined, /paidQuantity\s*:/);
});
