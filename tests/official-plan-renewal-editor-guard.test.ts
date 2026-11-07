import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { buildSubscriptionSaleModality } from '../shared/productSaleModality.js';

const modalityEditor = readFileSync('src/components/store/ProductSaleModalityEditor.tsx', 'utf8');
const productEditor = readFileSync('src/components/store/ProductEditorModal.tsx', 'utf8');

test('subscription builder accepts explicit manual renewal', () => {
  const modality = buildSubscriptionSaleModality({ billingUnit: 'month', benefitKind: 'access', autoRenew: false });
  assert.equal(modality.subscription?.autoRenew, false);
});

test('ERP editor preserves existing renewal flag and exposes explicit control', () => {
  assert.match(modalityEditor, /input\?\.autoRenew \?\? subscription\?\.autoRenew \?\? false/);
  assert.match(modalityEditor, /id="product-subscription-auto-renew"/);
  assert.match(modalityEditor, /checked=\{subscription\.autoRenew\}/);
});

test('unchanged fiscal profile does not trigger a separate fiscal write', () => {
  assert.match(productEditor, /JSON\.stringify\(nextFiscalProfile\) !== JSON\.stringify\(previousFiscalProfile\)/);
});
