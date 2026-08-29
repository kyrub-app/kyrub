import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import {
  parseAdminPlatformEconomyPeriod,
  resolveAdminPlatformEconomyPeriodScope,
} from '../shared/adminPlatformEconomyPeriod';

describe('admin platform economy period', () => {
  test('parses only supported presets and fails closed to all', () => {
    assert.equal(parseAdminPlatformEconomyPeriod('7d'), '7d');
    assert.equal(parseAdminPlatformEconomyPeriod(' 30D '), '30d');
    assert.equal(parseAdminPlatformEconomyPeriod('90d'), '90d');
    assert.equal(parseAdminPlatformEconomyPeriod('all'), 'all');
    assert.equal(parseAdminPlatformEconomyPeriod('365d'), 'all');
    assert.equal(parseAdminPlatformEconomyPeriod(undefined), 'all');
  });

  test('resolves rolling UTC scopes deterministically', () => {
    const now = new Date('2026-08-29T22:30:00.000Z');
    assert.deepEqual(resolveAdminPlatformEconomyPeriodScope('7d', now), {
      period: '7d',
      since: '2026-08-22T22:30:00.000Z',
      until: '2026-08-29T22:30:00.000Z',
    });
    assert.deepEqual(resolveAdminPlatformEconomyPeriodScope('30d', now), {
      period: '30d',
      since: '2026-07-30T22:30:00.000Z',
      until: '2026-08-29T22:30:00.000Z',
    });
    assert.deepEqual(resolveAdminPlatformEconomyPeriodScope('90d', now), {
      period: '90d',
      since: '2026-05-31T22:30:00.000Z',
      until: '2026-08-29T22:30:00.000Z',
    });
  });

  test('all has no lower bound and invalid clock is rejected', () => {
    const now = new Date('2026-08-29T22:30:00.000Z');
    assert.deepEqual(resolveAdminPlatformEconomyPeriodScope('all', now), {
      period: 'all',
      since: null,
      until: '2026-08-29T22:30:00.000Z',
    });
    assert.throws(
      () => resolveAdminPlatformEconomyPeriodScope('7d', new Date(Number.NaN)),
      /PERIOD_NOW_INVALID/
    );
  });
});
