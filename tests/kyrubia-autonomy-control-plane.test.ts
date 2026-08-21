import assert from 'node:assert/strict';
import test from 'node:test';
import { buildKyrubAutonomyLease } from '../server/actions/boundedAutonomyLease';
import { reconcileKyrubExecutionChain } from '../server/actions/reconciliationRecovery';
import { buildKyrubAutonomyControlPlaneSnapshot } from '../server/admin/autonomyControlPlaneService';

test('control plane shows registry status without action payloads', () => {
  const snapshot = buildKyrubAutonomyControlPlaneSnapshot({
    controls: {
      actionKillSwitches: { create_note: true },
      featureFlags: { 'kyrubia.autonomy.create_task': false },
    },
    now: new Date('2026-08-21T13:00:00.000Z'),
  });

  const note = snapshot.actions.find(item => item.actionType === 'create_note');
  const task = snapshot.actions.find(item => item.actionType === 'create_task');
  assert.equal(note?.killed, true);
  assert.equal(note?.enabled, false);
  assert.equal(task?.enabled, false);
  assert.equal('content' in (note ?? {}), false);
});

test('only live unexhausted leases appear in control plane', () => {
  const active = buildKyrubAutonomyLease({
    actorUid: 'user-1',
    correlationId: 'corr-cp-1',
    allowedActions: ['create_note'],
    durationMs: 60_000,
    maxUses: 2,
    now: new Date('2026-08-21T13:00:00.000Z'),
  });
  const expired = { ...active, leaseId: 'lease-expired', expiresAt: '2026-08-21T12:59:59.000Z' };
  const snapshot = buildKyrubAutonomyControlPlaneSnapshot({
    leases: [active, expired],
    now: new Date('2026-08-21T13:00:30.000Z'),
  });
  assert.deepEqual(snapshot.activeLeases.map(item => item.leaseId), [active.leaseId]);
});

test('reconciliation findings are summarized without reference payloads', () => {
  const findings = reconcileKyrubExecutionChain({
    snapshot: {
      correlationId: 'corr-cp-2',
      effectIds: ['effect-secret-ref'],
      receiptIds: [],
      eventIds: [],
      correlationStages: ['execution'],
    },
  });
  const snapshot = buildKyrubAutonomyControlPlaneSnapshot({ findings });
  assert.ok(snapshot.reconciliationFindings.length > 0);
  assert.equal('referenceIds' in snapshot.reconciliationFindings[0], false);
});
