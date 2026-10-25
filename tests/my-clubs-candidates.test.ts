import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { describe, test } from 'node:test';

describe('my clubs candidate endpoint contract', () => {
  const router = readFileSync('server/payments/myClubsCandidateRouter.ts', 'utf8');
  const server = readFileSync('server.ts', 'utf8');
  const client = readFileSync('src/utils/myClubsCandidates.ts', 'utf8');

  test('is mounted behind the existing integration rate limiter', () => {
    assert.match(server, /"\/api\/my-clubs",\s*integrationRateLimiter,\s*createMyClubsCandidateRouter\(\)/);
  });

  test('uses authenticated identity rather than a caller supplied customer ID', () => {
    assert.match(router, /verifyFirebaseIdToken\(token\)/);
    assert.match(router, /customerId: identity\.uid/);
    assert.doesNotMatch(router, /request\.body\?\.customerId|request\.query\.customerId/);
    assert.match(client, /user\.getIdToken\(\)/);
  });

  test('bounds candidate fan-out and rejects unsafe document identifiers', () => {
    assert.match(router, /MAX_STORES = 12/);
    assert.match(router, /raw\.length > MAX_STORES/);
    assert.match(router, /id\.includes\('\/'\)/);
    assert.match(router, /Promise\.allSettled/);
    assert.match(router, /complete: false/);
  });

  test('recognizes zero-point purchasers and avoids public coupon-only membership', () => {
    assert.match(router, /summary\.level\.confirmedPurchases > 0/);
    assert.match(router, /summary\.points\.lifetimeEarned > 0/);
    assert.doesNotMatch(router, /summary\.coupons\.length > 0/);
  });

  test('does not silently return a partial success on backend failures', () => {
    assert.match(router, /results\.some\(result => result\.status === 'rejected'\)/);
    assert.match(router, /response\.status\(503\)/);
  });
});
