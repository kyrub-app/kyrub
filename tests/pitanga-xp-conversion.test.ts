import assert from 'node:assert/strict';
import test from 'node:test';
import { PITANGAS_PER_XP, planVoluntaryPitangaXpConversion } from '../shared/pitangaXpConversion.js';

test('100 Pitangas convert voluntarily to one permanent XP', () => {
  assert.equal(PITANGAS_PER_XP, 100);
  assert.deepEqual(planVoluntaryPitangaXpConversion(100, 1), {
    pitangasToDebit: 100, xpToCredit: 1, remainingPitangas: 0,
  });
});

test('partial balance remains available for future redemption', () => {
  assert.deepEqual(planVoluntaryPitangaXpConversion(275, 2), {
    pitangasToDebit: 200, xpToCredit: 2, remainingPitangas: 75,
  });
});

test('no automatic conversion for balances under 100', () => {
  assert.throws(() => planVoluntaryPitangaXpConversion(99, 1), /PITANGA_BALANCE_INSUFFICIENT/);
});

test('refuses invalid, fractional, negative and overflowing amounts', () => {
  for (const balance of [-1, NaN, 1.5, Number.MAX_SAFE_INTEGER + 1]) {
    assert.throws(() => planVoluntaryPitangaXpConversion(balance, 1), /PITANGA_BALANCE_INVALID/);
  }
  for (const amount of [0, -1, 1.5, NaN]) {
    assert.throws(() => planVoluntaryPitangaXpConversion(100, amount), /XP_CONVERSION_AMOUNT_INVALID/);
  }
  assert.throws(() => planVoluntaryPitangaXpConversion(Number.MAX_SAFE_INTEGER, Number.MAX_SAFE_INTEGER), /XP_CONVERSION_OVERFLOW/);
});
