import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { describe, test } from 'node:test';
import {
  STORE_CHALLENGE_SCHEMA_VERSION,
  applyPaidStoreChallengeContribution,
  applyRefundedStoreChallengeContribution,
  isStoreChallengeActiveAt,
  normalizeStoreChallengeDefinition,
  type StoreChallengeDefinition,
  type StoreChallengeProgress,
} from '../shared/storeChallenges';

const challenge = (patch: Partial<StoreChallengeDefinition> = {}): StoreChallengeDefinition => ({
  schemaVersion: STORE_CHALLENGE_SCHEMA_VERSION,
  id: 'challenge-loyalty-3',
  storeId: 'store-a',
  title: 'Compre 3 vezes',
  description: 'Complete três compras confirmadas.',
  metric: 'purchase_count',
  target: 3,
  rewardPoints: 50,
  startsAt: '2026-08-01T00:00:00.000Z',
  endsAt: '2026-09-30T00:00:00.000Z',
  status: 'active',
  createdAt: '2026-08-01T00:00:00.000Z',
  updatedAt: '2026-08-01T00:00:00.000Z',
  ...patch,
});

const paid = (
  definition: StoreChallengeDefinition,
  paymentId: string,
  currentProgress: StoreChallengeProgress | null,
  paidTotalMinor = 1000
) => applyPaidStoreChallengeContribution({
  challenge: definition,
  customerId: 'customer-a',
  paymentId,
  orderId: `order-${paymentId}`,
  paidTotalMinor,
  occurredAt: '2026-08-28T20:00:00.000Z',
  currentProgress,
});

describe('store challenges', () => {
  test('normalizes a deterministic store-points challenge and rejects invalid periods', () => {
    const normalized = normalizeStoreChallengeDefinition(challenge());
    assert.equal(normalized.metric, 'purchase_count');
    assert.equal(normalized.rewardPoints, 50);
    assert.throws(
      () => normalizeStoreChallengeDefinition(
        challenge({ endsAt: '2026-08-01T00:00:00.000Z' })
      ),
      /STORE_CHALLENGE_PERIOD_INVALID/
    );
  });

  test('only counts an active challenge inside its configured period', () => {
    assert.equal(
      isStoreChallengeActiveAt(challenge(), '2026-08-28T12:00:00.000Z'),
      true
    );
    assert.equal(
      isStoreChallengeActiveAt(
        challenge({ status: 'paused' }),
        '2026-08-28T12:00:00.000Z'
      ),
      false
    );
    assert.equal(
      isStoreChallengeActiveAt(challenge(), '2026-10-01T00:00:00.000Z'),
      false
    );
  });

  test('awards store points exactly when purchase progress crosses the target', () => {
    const first = paid(challenge(), 'pay-1', null);
    assert.equal(first.progress.progress, 1);
    assert.equal(first.rewardEntry, null);

    const second = paid(challenge(), 'pay-2', first.progress);
    assert.equal(second.progress.progress, 2);
    assert.equal(second.rewardEntry, null);

    const third = paid(challenge(), 'pay-3', second.progress);
    assert.equal(third.progress.progress, 3);
    assert.equal(third.progress.status, 'completed');
    assert.equal(third.rewardEntry?.kind, 'bonus');
    assert.equal(third.rewardEntry?.currency, 'store_points');
    assert.equal(third.rewardEntry?.amount, 50);
    assert.match(third.rewardEntry?.id ?? '', /challenge:challenge-loyalty-3:completion:pay-3/);

    const fourth = paid(challenge(), 'pay-4', third.progress);
    assert.equal(fourth.progress.progress, 4);
    assert.equal(fourth.rewardEntry, null);
  });

  test('supports spend challenges using paid total in integer minor units', () => {
    const spend = challenge({
      id: 'challenge-spend',
      title: 'Gaste R$ 25',
      metric: 'spend_minor',
      target: 2500,
      rewardPoints: 80,
    });
    const first = paid(spend, 'pay-spend-1', null, 1000);
    assert.equal(first.progress.progress, 1000);
    assert.equal(first.rewardEntry, null);

    const second = paid(spend, 'pay-spend-2', first.progress, 1500);
    assert.equal(second.progress.progress, 2500);
    assert.equal(second.rewardEntry?.amount, 80);
  });

  test('refund below target reverses the active challenge reward without deleting history', () => {
    const first = paid(challenge(), 'pay-1', null);
    const second = paid(challenge(), 'pay-2', first.progress);
    const third = paid(challenge(), 'pay-3', second.progress);
    assert.ok(third.rewardEntry);

    const refunded = applyRefundedStoreChallengeContribution({
      challenge: challenge(),
      contribution: second.contribution,
      currentProgress: third.progress,
      activeRewardEntry: third.rewardEntry,
      occurredAt: '2026-08-29T10:00:00.000Z',
    });

    assert.equal(refunded.progress.progress, 2);
    assert.equal(refunded.progress.status, 'in_progress');
    assert.equal(refunded.progress.activeRewardEntryId, '');
    assert.equal(refunded.contribution.reversedAt, '2026-08-29T10:00:00.000Z');
    assert.equal(refunded.rewardReversal?.kind, 'reversal');
    assert.equal(refunded.rewardReversal?.amount, -50);
    assert.equal(refunded.rewardReversal?.reversalOf, third.rewardEntry?.id);
  });

  test('refund that keeps progress at target does not revoke the earned reward', () => {
    const first = paid(challenge(), 'pay-1', null);
    const second = paid(challenge(), 'pay-2', first.progress);
    const third = paid(challenge(), 'pay-3', second.progress);
    const fourth = paid(challenge(), 'pay-4', third.progress);

    const refunded = applyRefundedStoreChallengeContribution({
      challenge: challenge(),
      contribution: first.contribution,
      currentProgress: fourth.progress,
      activeRewardEntry: third.rewardEntry,
      occurredAt: '2026-08-29T10:00:00.000Z',
    });

    assert.equal(refunded.progress.progress, 3);
    assert.equal(refunded.progress.status, 'completed');
    assert.equal(refunded.rewardReversal, null);
    assert.equal(refunded.progress.activeRewardEntryId, third.rewardEntry?.id);
  });

  test('customer can complete again after a refund revoked the prior completion', () => {
    const first = paid(challenge(), 'pay-1', null);
    const second = paid(challenge(), 'pay-2', first.progress);
    const third = paid(challenge(), 'pay-3', second.progress);
    const refunded = applyRefundedStoreChallengeContribution({
      challenge: challenge(),
      contribution: first.contribution,
      currentProgress: third.progress,
      activeRewardEntry: third.rewardEntry,
      occurredAt: '2026-08-29T10:00:00.000Z',
    });

    const completedAgain = paid(
      challenge(),
      'pay-4',
      refunded.progress
    );
    assert.equal(completedAgain.progress.status, 'completed');
    assert.equal(completedAgain.rewardEntry?.amount, 50);
    assert.notEqual(completedAgain.rewardEntry?.id, third.rewardEntry?.id);
  });

  test('server owns progress idempotency and browser does not submit challenge progress', () => {
    const processorSource = readFileSync(
      new URL('../server/payments/storeChallengeProcessor.ts', import.meta.url),
      'utf8'
    );
    const checkoutSource = readFileSync(
      new URL('../src/utils/marketplaceCheckout.ts', import.meta.url),
      'utf8'
    );

    assert.match(processorSource, /contributionSnapshot\.exists/);
    assert.match(processorSource, /paymentId/);
    assert.match(processorSource, /storePointLedger/);
    assert.doesNotMatch(checkoutSource, /challengeProgress/);
    assert.doesNotMatch(checkoutSource, /challengeId/);
  });

  test('store challenge contract does not use K-Coins', () => {
    const source = readFileSync(
      new URL('../shared/storeChallenges.ts', import.meta.url),
      'utf8'
    );
    assert.doesNotMatch(source, /KCoin|kCoin|K-Coins/);
    assert.match(source, /buildStorePointBonusEntry/);
  });
});
