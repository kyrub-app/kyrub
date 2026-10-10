import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import {
  calculateCashDifference,
  calculateExpectedCash,
  getCashDirection,
  movementRequiresReason,
  resolveSelectedCashSession,
  type CanonicalCashSession,
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


const fakeCashSession = (
  id: string,
  status: 'open' | 'closed' = 'open'
): CanonicalCashSession => ({
  id,
  status,
  storeId: 'store-a',
  operatorUserId: 'cashier-a',
  operatorRole: 'cashier',
  operatorName: 'Operador de teste',
  openingAmount: 50,
  expectedAmount: 50,
  countedAmount: 0,
  difference: 0,
  openedAt: '2026-10-10T09:00:00.000Z',
  closedAt: '',
  closedByUserId: '',
  closedByRole: '',
  closedByName: '',
  closeReason: '',
  deviceId: 'browser-a',
  legacyStoreId: 'owner-a',
  createdAt: '2026-10-10T09:00:00.000Z',
  updatedAt: '2026-10-10T09:00:00.000Z',
});

test('cash session selection never silently chooses among multiple open sessions', () => {
  const a = fakeCashSession('session-a');
  const b = fakeCashSession('session-b');
  const closed = fakeCashSession('session-closed', 'closed');
  assert.equal(resolveSelectedCashSession([], ''), null);
  assert.equal(resolveSelectedCashSession([a], ''), a);
  assert.equal(resolveSelectedCashSession([a, closed], ''), a);
  assert.equal(resolveSelectedCashSession([a, b], ''), null);
  assert.equal(resolveSelectedCashSession([a, b], 'session-a'), a);
  assert.equal(resolveSelectedCashSession([a, b], 'session-b'), b);
  assert.equal(resolveSelectedCashSession([a, b], 'session-closed'), null);
  assert.equal(resolveSelectedCashSession([a, b, closed], 'session-closed'), null);
  assert.equal(resolveSelectedCashSession([a, b], 'other-store-session'), null);
  assert.equal(resolveSelectedCashSession([b, a], 'session-a'), a);
});

test('existing canonical cash workspace waits for selected session ledger before writes', () => {
  const view = readFileSync('src/components/store/CashWorkspace.tsx', 'utf8');
  assert.match(view, /resolveSelectedCashSession\(openSessions, selectedSessionId\)/);
  assert.match(view, /data-kyrub-cash-session-selector="explicit"/);
  assert.match(view, /openSessions\.length > 1/);
  assert.match(view, /setSelectedSessionId\(event\.target\.value\)/);
  assert.match(view, /loadedMovementSessionId === activeSession\.id/);
  assert.match(view, /!context \|\| !activeSession \|\| !movementsReady/);
  assert.match(view, /disabled=\{busy \|\| !movementsReady\}/);
  assert.doesNotMatch(view, /sessions\.find\(session => session\.status === 'open'\)/);
});
