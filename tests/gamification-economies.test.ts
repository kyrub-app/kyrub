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

test('Kyrubia Credits are a distinct purchased AI economy', () => {
  assert.equal(KYRUB_ECONOMIES.kyrubia_credits.purchasableWithMoney, true);
  assert.equal(KYRUB_ECONOMIES.kyrubia_credits.convertibleToKCoin, false);
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
