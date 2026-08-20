import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import {
  advanceOmnichannelCursor,
  buildOmnichannelIdempotencyKey,
  calculateOmnichannelRetryDelayMs,
  canReserveOmnichannelWork,
  decideOmnichannelReconciliation,
} from '../src/utils/omnichannelSyncEngine';

describe('omnichannel sync engine', () => {
  test('builds a stable idempotency key scoped by store, channel, direction and entity', () => {
    const first = buildOmnichannelIdempotencyKey({
      storeId: 'store-1',
      channelId: '99food',
      direction: 'inbound',
      entityType: 'order',
      externalEventId: 'event/123',
    });
    const second = buildOmnichannelIdempotencyKey({
      storeId: ' store-1 ',
      channelId: '99food',
      direction: 'inbound',
      entityType: 'order',
      externalEventId: ' event/123 ',
    });

    assert.equal(first, second);
    assert.notEqual(
      first,
      buildOmnichannelIdempotencyKey({
        storeId: 'store-1',
        channelId: 'ifood',
        direction: 'inbound',
        entityType: 'order',
        externalEventId: 'event/123',
      })
    );
  });

  test('uses bounded exponential backoff', () => {
    assert.equal(calculateOmnichannelRetryDelayMs(1), 30_000);
    assert.equal(calculateOmnichannelRetryDelayMs(2), 60_000);
    assert.equal(calculateOmnichannelRetryDelayMs(20), 15 * 60_000);
    assert.throws(() => calculateOmnichannelRetryDelayMs(0), /positive integer/i);
  });

  test('does not reserve completed, leased or future-retry work', () => {
    assert.equal(
      canReserveOmnichannelWork({ status: 'processed', nowMs: 100 }),
      false
    );
    assert.equal(
      canReserveOmnichannelWork({
        status: 'processing',
        nowMs: 100,
        leaseExpiresAtMs: 200,
      }),
      false
    );
    assert.equal(
      canReserveOmnichannelWork({
        status: 'failed',
        nowMs: 100,
        nextAttemptAtMs: 200,
      }),
      false
    );
    assert.equal(
      canReserveOmnichannelWork({
        status: 'processing',
        nowMs: 300,
        leaseExpiresAtMs: 200,
      }),
      true
    );
  });

  test('advances cursors monotonically and rejects rollback', () => {
    assert.deepEqual(
      advanceOmnichannelCursor(
        { checkpoint: 'page-1', observedAtMs: 100 },
        { checkpoint: 'page-2', observedAtMs: 200 }
      ),
      { checkpoint: 'page-2', observedAtMs: 200 }
    );
    assert.throws(
      () => advanceOmnichannelCursor(
        { checkpoint: 'page-2', observedAtMs: 200 },
        { checkpoint: 'page-1', observedAtMs: 100 }
      ),
      /cannot move backwards/i
    );
  });

  test('reconciles one-sided changes and exposes concurrent divergence as conflict', () => {
    assert.equal(
      decideOmnichannelReconciliation({
        canonicalVersion: 'c2',
        externalVersion: 'e1',
        lastSyncedCanonicalVersion: 'c1',
        lastSyncedExternalVersion: 'e1',
      }),
      'push-canonical'
    );
    assert.equal(
      decideOmnichannelReconciliation({
        canonicalVersion: 'c1',
        externalVersion: 'e2',
        lastSyncedCanonicalVersion: 'c1',
        lastSyncedExternalVersion: 'e1',
      }),
      'pull-external'
    );
    assert.equal(
      decideOmnichannelReconciliation({
        canonicalVersion: 'c2',
        externalVersion: 'e2',
        lastSyncedCanonicalVersion: 'c1',
        lastSyncedExternalVersion: 'e1',
      }),
      'conflict'
    );
    assert.equal(
      decideOmnichannelReconciliation({
        canonicalVersion: 'same',
        externalVersion: 'same',
        lastSyncedCanonicalVersion: 'old-c',
        lastSyncedExternalVersion: 'old-e',
      }),
      'noop'
    );
  });
});
