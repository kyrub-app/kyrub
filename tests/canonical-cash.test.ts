import assert from 'node:assert/strict';
import test from 'node:test';
import {
  calculateCashDifference,
  calculateExpectedCash,
  getCashDirection,
  movementRequiresReason,
} from '../src/utils/canonicalCash';
import {
  getStoreCashMovementsCollectionPath,
  getStoreCashSessionDocumentPath,
} from '../src/utils/storeSecurity';

test('cash totals combine opening amount, entries and outputs', () => {
  const expected = calculateExpectedCash(100, [
    { direction: 'in', amount: 50 },
    { direction: 'out', amount: 20 },
    { direction: 'in', amount: 10.55 },
  ]);

  assert.equal(expected, 140.55);
  assert.equal(calculateCashDifference(138.55, expected), -2);
});

test('cash movement types resolve their financial direction', () => {
  assert.equal(getCashDirection('income'), 'in');
  assert.equal(getCashDirection('supply'), 'in');
  assert.equal(getCashDirection('sale'), 'in');
  assert.equal(getCashDirection('expense'), 'out');
  assert.equal(getCashDirection('withdrawal'), 'out');
  assert.equal(getCashDirection('adjustment', 'out'), 'out');
});

test('sensitive cash movements require a reason', () => {
  assert.equal(movementRequiresReason('withdrawal'), true);
  assert.equal(movementRequiresReason('expense'), true);
  assert.equal(movementRequiresReason('adjustment'), true);
  assert.equal(movementRequiresReason('income'), false);
  assert.equal(movementRequiresReason('supply'), false);
});

test('cash paths remain scoped to a single canonical store and session', () => {
  assert.equal(
    getStoreCashSessionDocumentPath('store-a', 'session-a'),
    'stores/store-a/cashSessions/session-a'
  );
  assert.equal(
    getStoreCashMovementsCollectionPath('store-a', 'session-a'),
    'stores/store-a/cashSessions/session-a/movements'
  );
});
