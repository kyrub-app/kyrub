import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const wrapper = readFileSync('src/components/customer/TableServiceWorkspace.tsx', 'utf8');
const workspace = readFileSync('src/components/customer/LegacyTableServiceWorkspace.tsx', 'utf8');
const tableOperations = readFileSync('src/utils/legacyTableOperations.ts', 'utf8');
const pixClient = readFileSync('src/utils/localPixCheckout.ts', 'utf8');
const financialPanel = readFileSync('src/components/store/ServiceLocationFinancialContextPanel.tsx', 'utf8');

test('staff account removes the verbose canonical block but preserves canonical Pix', () => {
  assert.doesNotMatch(wrapper, /staff-table-canonical-coupon-checkout-host/);
  assert.doesNotMatch(wrapper, /Checkout canônico · Mesa/);
  assert.doesNotMatch(wrapper, /Cupom, valor final e cobrança Pix/);
  assert.match(wrapper, /staff-table-canonical-pix-checkout/);
  assert.match(wrapper, /ServiceLocationFinancialContextPanel/);
});

test('coupon sits below payable balance and before payment method buttons', () => {
  const balance = workspace.indexOf('Saldo a pagar');
  const coupon = workspace.indexOf('Cupom de desconto');
  const paymentMethods = workspace.indexOf("(['cash', 'pix', 'card', 'other']");
  assert.ok(balance >= 0);
  assert.ok(coupon > balance);
  assert.ok(paymentMethods > coupon);
  assert.match(workspace, /staff-table-coupon-code/);
  assert.match(workspace, /Aplicar/);
  assert.match(workspace, /payablePaymentTotal/);
  assert.match(workspace, /couponQuote\.discountTotal/);
});

test('coupon quote is authenticated server authority and updates the recorded payment amount', () => {
  assert.match(pixClient, /\/api\/payments\/coupons\/quote/);
  assert.match(pixClient, /authorizedFetch/);
  assert.match(workspace, /quoteLocalCoupon/);
  assert.match(workspace, /assertCouponMatchesSelection/);
  assert.match(workspace, /coupon: confirmedCoupon/);
  assert.match(tableOperations, /originalAmount: selectedSubtotal/);
  assert.match(tableOperations, /discountAmount/);
  assert.match(tableOperations, /couponCode: coupon\?\.code/);
  assert.match(tableOperations, /amount: paymentAmount/);
});

test('Pix reuses the already-applied coupon instead of rendering a second coupon input', () => {
  assert.match(wrapper, /couponCode=\{appliedCouponCode\}/);
  assert.match(financialPanel, /couponCode: appliedCouponCode = ''/);
  assert.match(financialPanel, /const couponCode = appliedCouponCode\.trim\(\)/);
  assert.doesNotMatch(financialPanel, /id=\{`coupon-\$\{order\.id\}`\}/);
  assert.match(financialPanel, /couponCode,/);
});
