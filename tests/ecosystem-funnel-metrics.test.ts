import test from 'node:test';
import assert from 'node:assert/strict';
import {
  countActivePaidOwners,
  calculatePaidStoreConversion,
} from '../shared/ecosystemFunnelMetrics.ts';

test('only distinct active paid subscriptions count', () => {
  assert.equal(countActivePaidOwners([
    { ownerId: 'a', plan: 'pro', source: 'subscription', status: 'active' },
    { ownerId: 'a', plan: 'business', source: 'subscription', status: 'active' },
    { ownerId: 'b', plan: 'business', source: 'subscription', status: 'active' },
    { ownerId: 'c', plan: 'business', source: 'promotion', status: 'active' },
    { ownerId: 'd', plan: 'pro', source: 'subscription', status: 'cancelled' },
    { ownerId: 'e', plan: 'free', source: 'subscription', status: 'active' },
    { ownerId: '', plan: 'pro', source: 'subscription', status: 'active' },
  ]), 2);
});

test('conversion is unavailable for missing or inconsistent data', () => {
  assert.equal(calculatePaidStoreConversion(2, 10), 20);
  assert.equal(calculatePaidStoreConversion(0, 10), 0);
  assert.equal(calculatePaidStoreConversion(0, 0), null);
  assert.equal(calculatePaidStoreConversion(null, 10), null);
  assert.equal(calculatePaidStoreConversion(11, 10), null);
});
