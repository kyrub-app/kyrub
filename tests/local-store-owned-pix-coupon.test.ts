import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const attach = readFileSync('server/attendance/localStoreOwnedPixService.ts', 'utf8');
const confirmation = readFileSync('server/attendance/localStoreOwnedPixConfirmationService.ts', 'utf8');

for (const [name, source, paidAmount] of [
  ['QR attachment', attach, 'authoritativelyPaidAmount'],
  ['operator confirmation', confirmation, 'otherPaidAmount'],
] as const) {
  test(`store-owned Pix ${name} checks discounted canonical amount and prevents partial coupon settlement`, () => {
    assert.match(source, /const commercialSnapshot = intent\.commercialSnapshot/);
    assert.match(source, /commercialSnapshot\?\.couponCode/);
    assert.ok(source.includes(`${paidAmount} > 0.009`));
    assert.match(source, /Math\.abs\(commercialSnapshot\.subtotal - remaining\) > 0\.009/);
    assert.match(source, /commercialSnapshot\.discountTotal <= 0/);
    assert.match(source, /Math\.abs\(commercialSnapshot\.subtotal - commercialSnapshot\.discountTotal - (?:intent|payment)\.amount\) > 0\.009/);
    assert.match(source, /Math\.abs\(commercialSnapshot\.total - (?:intent|payment)\.amount\) > 0\.009/);
    assert.match(source, /else if \(Math\.abs\(remaining - (?:intent|payment)\.amount\) > 0\.009\)/);
  });
}

test('operator attestation records the net payment amount, not gross order total', () => {
  assert.match(confirmation, /amountMinor: brlToMinor\(payment\.amount\)/);
  assert.match(confirmation, /amount: payment\.amount/);
  assert.match(confirmation, /sourceAuthority: 'operator_attestation'/);
  assert.match(confirmation, /bankVerifiedByKyrub: false/);
});


test('operator-confirmed coupon capture persists immutable economic allocation for margins', () => {
  assert.match(confirmation, /economicAllocation: buildMarketplaceEconomicAllocationSnapshot\(\{/);
  assert.match(confirmation, /subtotal: commercialSnapshot\.subtotal/);
  assert.match(confirmation, /discountTotal: commercialSnapshot\.discountTotal/);
  assert.match(confirmation, /deliveryFee: 0/);
  assert.match(confirmation, /total: payment\.amount/);
  assert.match(confirmation, /\.\.\.\(commercialSnapshot\?\.couponCode \? \{/);
});
