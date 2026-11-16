import test from 'node:test';
import assert from 'node:assert/strict';
import { calculateIsolatedBusinessExpiry } from '../server/payments/officialPlanPromotionIsolatedActivation.js';

test('isolated Business monthly term clamps end-of-month in UTC', () => {
  const examples = [
    ['2026-01-31T12:34:56.000Z', '2026-02-28T12:34:56.000Z'],
    ['2028-01-31T12:34:56.000Z', '2028-02-29T12:34:56.000Z'],
    ['2026-03-31T12:34:56.000Z', '2026-04-30T12:34:56.000Z'],
    ['2026-12-31T12:34:56.000Z', '2027-01-31T12:34:56.000Z'],
    ['2026-11-16T12:00:00.000Z', '2026-12-16T12:00:00.000Z'],
  ] as const;
  for (const [paidAt, expected] of examples) {
    assert.equal(calculateIsolatedBusinessExpiry(paidAt).toISOString(), expected);
  }
  assert.throws(() => calculateIsolatedBusinessExpiry('not-a-date'), /PAYMENT_DATE_REQUIRED/);
});
