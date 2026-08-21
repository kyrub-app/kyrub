import assert from 'node:assert/strict';
import test from 'node:test';
import {
  reconcileKyrubExecutionChain,
  recommendKyrubRecovery,
} from '../server/actions/reconciliationRecovery';

test('effect without receipt is classified before any repair', () => {
  const [finding] = reconcileKyrubExecutionChain({
    snapshot: {
      correlationId: 'corr-rec-1',
      effectIds: ['note-1'],
      receiptIds: [],
      eventIds: [],
      correlationStages: ['preview', 'authorization', 'execution'],
    },
    detectedAt: new Date('2026-08-21T13:00:00.000Z'),
  });

  assert.equal(finding.code, 'EFFECT_WITHOUT_RECEIPT');
  assert.equal(finding.autoRepairAllowed, false);
  assert.equal(recommendKyrubRecovery(finding).requiresHumanApproval, true);
});

test('receipt without domain event recommends idempotent event replay only', () => {
  const findings = reconcileKyrubExecutionChain({
    snapshot: {
      correlationId: 'corr-rec-2',
      effectIds: ['product-1'],
      receiptIds: ['receipt-1'],
      eventIds: [],
      correlationStages: ['preview', 'authorization', 'execution', 'receipt'],
    },
  });
  const finding = findings.find(item => item.code === 'RECEIPT_WITHOUT_EVENT');
  assert.ok(finding);
  assert.equal(recommendKyrubRecovery(finding).mode, 'replay_idempotent_event');
});

test('duplicate events and incomplete chain are independently visible', () => {
  const findings = reconcileKyrubExecutionChain({
    snapshot: {
      correlationId: 'corr-rec-3',
      effectIds: ['order-1'],
      receiptIds: ['receipt-1'],
      eventIds: ['event-1', 'event-1'],
      correlationStages: ['execution', 'receipt', 'domain_event'],
    },
  });
  assert.ok(findings.some(item => item.code === 'DUPLICATE_EVENT'));
  assert.ok(findings.some(item => item.code === 'INCOMPLETE_CORRELATION_CHAIN'));
});

test('healthy complete chain produces no finding', () => {
  const findings = reconcileKyrubExecutionChain({
    snapshot: {
      correlationId: 'corr-rec-4',
      effectIds: ['task-1'],
      receiptIds: ['receipt-1'],
      eventIds: ['event-1'],
      correlationStages: ['preview', 'authorization', 'execution', 'receipt', 'domain_event'],
    },
  });
  assert.deepEqual(findings, []);
});
