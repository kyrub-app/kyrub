import assert from 'node:assert/strict';
import test from 'node:test';
import {
  assertKyrubAutonomyLeaseUse,
  buildKyrubAutonomyLease,
  consumeKyrubAutonomyLease,
} from '../server/actions/boundedAutonomyLease';

test('level-four lease is limited to actions explicitly eligible for level four', () => {
  const lease = buildKyrubAutonomyLease({
    actorUid: 'user-1',
    correlationId: 'corr-lease-1',
    allowedActions: ['create_note', 'create_task'],
    durationMs: 60_000,
    maxUses: 3,
    now: new Date('2026-08-21T13:00:00.000Z'),
  });

  assert.deepEqual(lease.allowedActions, ['create_note', 'create_task']);
  assert.equal(lease.autonomyLevel, 4);
  assert.equal(lease.remainingUses, 3);
});

test('medium-risk operational mutation cannot receive level-four lease', () => {
  assert.throws(
    () => buildKyrubAutonomyLease({
      actorUid: 'user-1',
      correlationId: 'corr-lease-2',
      allowedActions: ['adjust_inventory'],
      durationMs: 60_000,
      maxUses: 1,
    }),
    /AUTONOMY_LEVEL_NOT_ALLOWED:adjust_inventory/
  );
});

test('runtime kill switch is re-evaluated on every autonomous use', () => {
  const lease = buildKyrubAutonomyLease({
    actorUid: 'user-1',
    correlationId: 'corr-lease-3',
    allowedActions: ['create_note'],
    durationMs: 60_000,
    maxUses: 2,
    now: new Date('2026-08-21T13:00:00.000Z'),
  });

  assert.throws(
    () => assertKyrubAutonomyLeaseUse({
      lease,
      actorUid: 'user-1',
      actionType: 'create_note',
      controls: { globalKillSwitch: true },
      now: new Date('2026-08-21T13:00:30.000Z'),
    }),
    /GLOBAL_KILL_SWITCH/
  );
});

test('lease scope and use count remain bounded', () => {
  const lease = buildKyrubAutonomyLease({
    actorUid: 'user-1',
    correlationId: 'corr-lease-4',
    allowedActions: ['prepare_product_draft'],
    scopeRef: 'store:store-1',
    durationMs: 60_000,
    maxUses: 1,
    now: new Date('2026-08-21T13:00:00.000Z'),
  });

  assert.throws(
    () => assertKyrubAutonomyLeaseUse({
      lease,
      actorUid: 'user-1',
      actionType: 'prepare_product_draft',
      scopeRef: 'store:store-2',
      now: new Date('2026-08-21T13:00:30.000Z'),
    }),
    /AUTONOMY_SCOPE_MISMATCH/
  );

  const consumed = consumeKyrubAutonomyLease(lease);
  assert.equal(consumed.remainingUses, 0);
  assert.throws(() => consumeKyrubAutonomyLease(consumed), /AUTONOMY_LEASE_EXHAUSTED/);
});
