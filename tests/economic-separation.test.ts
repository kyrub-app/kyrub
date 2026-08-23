import assert from 'node:assert/strict';
import test from 'node:test';
import { assertNoAutomaticEconomicConversion, economicUnitsAreDistinct } from '../shared/economicSeparation';

test('store points, K-Coins and financial balance remain distinct units', () => {
  assert.equal(economicUnitsAreDistinct('store_points', 'kcoins'), true);
  assert.equal(economicUnitsAreDistinct('kcoins', 'financial_balance'), true);
  assert.equal(economicUnitsAreDistinct('xp', 'kcoins'), true);
});

test('automatic Store Points to K-Coins conversion is forbidden', () => {
  assert.throws(() => assertNoAutomaticEconomicConversion({ from: 'store_points', to: 'kcoins', amount: 100, storeId: 'store-1' }), /AUTOMATIC_ECONOMIC_CONVERSION_FORBIDDEN/);
});

test('K-Coins can never silently become financial balance', () => {
  assert.throws(() => assertNoAutomaticEconomicConversion({ from: 'kcoins', to: 'financial_balance', amount: 100 }), /AUTOMATIC_ECONOMIC_CONVERSION_FORBIDDEN/);
});
