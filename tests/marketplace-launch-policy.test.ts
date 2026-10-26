import assert from 'node:assert/strict';
import test from 'node:test';
import {
  isWithinMarketplaceCommissionExemption,
  quoteMarketplaceLaunchPolicyAt,
} from '../shared/marketplaceLaunchPolicyProposal.js';

test('three calendar months begin on first activation and end on the anniversary', () => {
  const activation = '2026-10-26T15:00:00.000Z';
  assert.equal(isWithinMarketplaceCommissionExemption(activation, activation), true);
  assert.equal(isWithinMarketplaceCommissionExemption(activation, '2027-01-26T14:59:59.999Z'), true);
  assert.equal(isWithinMarketplaceCommissionExemption(activation, '2027-01-26T15:00:00.000Z'), false);
  assert.equal(isWithinMarketplaceCommissionExemption(activation, '2026-10-26T14:59:59.999Z'), false);
});

test('month-end activation clamps to last valid day in target month', () => {
  assert.equal(
    isWithinMarketplaceCommissionExemption('2026-11-30T12:00:00Z', '2027-02-27T12:00:00Z'),
    true
  );
  assert.equal(
    isWithinMarketplaceCommissionExemption('2026-11-30T12:00:00Z', '2027-02-28T12:00:00Z'),
    false
  );
});

test('fee quote applies 7% after exemption and keeps consumer service fee separate', () => {
  const input = {
    eligibleProductsMinor: 10_000,
    firstActivationIso: '2026-10-26T15:00:00Z',
  };
  assert.deepEqual(
    quoteMarketplaceLaunchPolicyAt({ ...input, orderCreatedIso: '2026-11-01T00:00:00Z' }),
    { merchantCommissionMinor: 0, consumerServiceFeeMinor: 100, merchantExempt: true }
  );
  assert.deepEqual(
    quoteMarketplaceLaunchPolicyAt({ ...input, orderCreatedIso: '2027-02-01T00:00:00Z' }),
    { merchantCommissionMinor: 700, consumerServiceFeeMinor: 100, merchantExempt: false }
  );
});

test('rejects missing activation and invalid monetary values', () => {
  assert.throws(() => isWithinMarketplaceCommissionExemption('', '2026-11-01T00:00:00Z'));
  assert.throws(() => quoteMarketplaceLaunchPolicyAt({
    eligibleProductsMinor: -1,
    firstActivationIso: '2026-10-26T15:00:00Z',
    orderCreatedIso: '2027-02-01T00:00:00Z',
  }));
});
