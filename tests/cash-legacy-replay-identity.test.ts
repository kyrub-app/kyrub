import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import {
  assertCashReplayFieldsMatch,
  selectPendingCashReplay,
  type CashStoreContext,
} from '../src/utils/canonicalCash';

type Session = Parameters<typeof selectPendingCashReplay>[1][number];
type Movement = Parameters<typeof selectPendingCashReplay>[2][number];

const context: CashStoreContext = {
  store: { id: 'store-a' } as CashStoreContext['store'],
  role: 'cashier',
  userId: 'bruno',
  operatorName: 'Bruno',
  legacyStoreId: 'owner-a',
};

const session = (overrides: Partial<Session> = {}): Session => ({
  canonicalId: 'cash-session-1',
  storeId: 'store-a',
  status: 'open',
  openedAt: '2026-10-10T12:00:00.000Z',
  initialCash: 100,
  expectedAmount: 100,
  difference: 0,
  operatorUserId: 'bruno',
  operatorRole: 'cashier',
  operatorName: 'Bruno',
  closedByUserId: '',
  closedByRole: '',
  closedByName: '',
  closeReason: '',
  deviceId: 'device-a',
  legacyStoreId: 'owner-a',
  createSynced: false,
  closeSynced: false,
  ...overrides,
});

const movement = (overrides: Partial<Movement> = {}): Movement => ({
  canonicalId: 'cash-movement-1',
  sessionId: 'cash-session-1',
  type: 'entrada',
  movementType: 'supply',
  direction: 'in',
  description: 'Troco adicional',
  amount: 50,
  category: 'Suprimento',
  reason: '',
  timestamp: '2026-10-10T12:00:00.000Z',
  actorUserId: 'bruno',
  actorRole: 'cashier',
  actorName: 'Bruno',
  source: 'manual',
  paymentId: '',
  deviceId: 'device-a',
  legacyStoreId: 'owner-a',
  synced: false,
  ...overrides,
});

test('shared device sync replays only current actor and canonical store records', () => {
  const selected = selectPendingCashReplay(context, [
    session(),
    session({ canonicalId: 'someone-else', operatorUserId: 'ana' }),
    session({ canonicalId: 'another-store', storeId: 'store-b' }),
    session({ canonicalId: 'another-tenant', legacyStoreId: 'owner-b' }),
    session({ canonicalId: 'already-synced', createSynced: true }),
    session({ canonicalId: 'manager-close', operatorUserId: 'ana', status: 'closed', closeSynced: false, closedByUserId: 'bruno' }),
    session({ canonicalId: 'ana-close', operatorUserId: 'bruno', status: 'closed', closeSynced: false, closedByUserId: 'ana' }),
  ], [
    movement(),
    movement({ canonicalId: 'ana-movement', actorUserId: 'ana' }),
    movement({ canonicalId: 'wrong-tenant', legacyStoreId: 'owner-b' }),
    movement({ canonicalId: 'missing-session', sessionId: '' }),
    movement({ canonicalId: 'already-synced', synced: true }),
  ]);
  assert.deepEqual(selected.openings.map(record => record.canonicalId), ['cash-session-1', 'ana-close']);
  assert.deepEqual(selected.closings.map(record => record.canonicalId), ['manager-close']);
  assert.deepEqual(selected.movements.map(record => record.canonicalId), ['cash-movement-1']);
});

test('no pending records from other account are presented as this actor\'s queue', () => {
  const selected = selectPendingCashReplay(
    { ...context, userId: 'ana' },
    [session()],
    [movement()]
  );
  assert.equal(selected.openings.length, 0);
  assert.equal(selected.closings.length, 0);
  assert.equal(selected.movements.length, 0);
});

test('matching immutable replay payload succeeds and mismatched actor, session or value conflicts', () => {
  const remote = {
    id: 'cash-movement-1',
    sessionId: 'cash-session-1',
    actorUserId: 'bruno',
    amount: 50,
    direction: 'in',
    paymentId: '',
    type: 'supply',
  };
  assert.doesNotThrow(() => assertCashReplayFieldsMatch(remote, { ...remote }));
  for (const expected of [
    { actorUserId: 'ana' },
    { sessionId: 'another-session' },
    { amount: 100 },
    { paymentId: 'payment-123' },
    { type: 'sale' },
  ]) {
    assert.throws(
      () => assertCashReplayFieldsMatch(remote, { ...remote, ...expected }),
      /CASH_LEGACY_REPLAY_CONFLICT/
    );
  }
});

test('legacy transport refuses server-managed sessions and verifies existing documents before replay', () => {
  const source = readFileSync('src/utils/canonicalCash.ts', 'utf8');
  assert.match(source, /session\?\.deviceId === 'server-managed-register'/);
  assert.match(source, /remote\.deviceId === 'server-managed-register'/);
  assert.match(source, /assertLegacyCashActor\(context, local\.actorUserId/);
  assert.match(source, /assertLegacyCashActor\(context, local\.operatorUserId/);
  assert.match(source, /assertLegacyCashActor\(context, local\.closedByUserId/);
  assert.match(source, /assertCashReplayFieldsMatch\(existing\.data\(\)/);
  assert.match(source, /selectPendingCashReplay\(context, sessions, movements\)/);
});
