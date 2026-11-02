import assert from 'node:assert/strict';
import test from 'node:test';
import {
  KYRUB_ECONOMIES,
  assertNoAutomaticEconomyConversion,
  isKCoinFinancialBalance,
} from '../shared/gamificationEconomies';

test('K-Coins are earned reward units, not money and not purchased balance', () => {
  assert.equal(KYRUB_ECONOMIES.k_coin.monetaryBalance, false);
  assert.equal(KYRUB_ECONOMIES.k_coin.purchasableWithMoney, false);
  assert.equal(isKCoinFinancialBalance(), false);
});

test('obsolete Kyrubia AI credits are not an active reward economy', () => {
  assert.equal(Object.hasOwn(KYRUB_ECONOMIES, 'kyrubia_credits'), false);
});

test('XP and Store Points cannot automatically convert into K-Coins', () => {
  assert.throws(
    () => assertNoAutomaticEconomyConversion('kyrub_xp', 'k_coin'),
    /AUTOMATIC_ECONOMY_CONVERSION_FORBIDDEN/
  );
  assert.throws(
    () => assertNoAutomaticEconomyConversion('store_loyalty_points', 'k_coin'),
    /AUTOMATIC_ECONOMY_CONVERSION_FORBIDDEN/
  );
});
