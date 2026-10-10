import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import {
  assertCashReplayFieldsMatch,
  inspectCashLocalQueue,
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

test('local queue report separates current employee and other operators on same device', () => {
  const audit = inspectCashLocalQueue(context, [
    session(),
    session({ canonicalId: 'session-ana', operatorUserId: 'ana' }),
    session({ canonicalId: 'closed-ana', status: 'closed', createSynced: true, closeSynced: false, closedByUserId: 'ana' }),
    session({ canonicalId: 'closed-bruno', status: 'closed', createSynced: true, closeSynced: false, closedByUserId: 'bruno' }),
    session({ canonicalId: 'unattributed-close', status: 'closed', createSynced: true, closeSynced: false, closedByUserId: '' }),
  ], [
    movement(),
    movement({ canonicalId: 'movement-ana', actorUserId: 'ana' }),
    movement({ canonicalId: 'movement-unattributed', actorUserId: '' }),
    movement({ canonicalId: 'already-synced', synced: true }),
    movement({ canonicalId: 'other-tenant', legacyStoreId: 'owner-b' }),
  ]);
  assert.equal(audit.currentActorPending, 3);
  assert.equal(audit.otherActorsPending, 3);
  assert.equal(audit.unattributedPending, 2);
  assert.equal(audit.localOpenSessions, 2);
  assert.equal(audit.pendingOpeningOperations, 2);
  assert.equal(audit.pendingClosingOperations, 3);
  assert.equal(audit.pendingMovementOperations, 3);
  assert.equal(audit.migrationAllowed, false);
  assert.equal(audit.otherDevicesVerified, false);
  assert.equal(audit.requiresReview, true);
});

test('empty browser queue never means the whole store is migration-ready', () => {
  const audit = inspectCashLocalQueue(context, [], []);
  assert.equal(audit.currentActorPending, 0);
  assert.equal(audit.otherActorsPending, 0);
  assert.equal(audit.requiresReview, false);
  assert.equal(audit.migrationAllowed, false);
  assert.equal(audit.otherDevicesVerified, false);
});

test('local audit never leaks actor identifiers or financial payloads through the summary', () => {
  const audit = inspectCashLocalQueue(context, [
    session({ operatorUserId: 'private-actor', initialCash: 934.95 }),
  ], [
    movement({ actorUserId: 'private-actor', amount: 3451.33, paymentId: 'secret-pay' }),
  ]);
  const json = JSON.stringify(audit);
  assert.doesNotMatch(json, /private-actor|secret-pay|934\.95|3451\.33/);
});

test('Cash UI replaces misleading global sync claim with device-local read-only inventory', () => {
  const source = readFileSync('src/components/store/CashWorkspace.tsx', 'utf8');
  assert.doesNotMatch(source, /Dexie e Firestore sincronizados/);
  assert.match(source, /data-kyrub-cash-local-audit="read-only"/);
  assert.match(source, /getCashLocalQueueAudit\(context\)/);
});
