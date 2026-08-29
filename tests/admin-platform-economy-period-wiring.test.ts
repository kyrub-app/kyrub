import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { describe, test } from 'node:test';

describe('admin platform economy period wiring', () => {
  test('router parses period and forwards it to the authoritative service', () => {
    const router = readFileSync('server/admin/platformEconomyRouter.ts', 'utf8');
    assert.match(router, /parseAdminPlatformEconomyPeriod/);
    assert.match(router, /request\.query\.period/);
    assert.match(router, /loadAdminPlatformEconomySnapshot\(period\)/);
  });

  test('service scopes economic and AI authorities with their canonical clocks', () => {
    const service = readFileSync('server/admin/platformEconomyService.ts', 'utf8');
    assert.match(service, /resolveAdminPlatformEconomyPeriodScope/);
    assert.match(service, /where\('occurredAt', '>=', scope\.since\)/);
    assert.match(service, /where\('createdAt', '>=', Timestamp\.fromDate/);
    assert.match(service, /collectionGroup\('economicLedger'\)/);
    assert.match(service, /collection\('kyrub_usage_events'\)/);
  });

  test('browser sends only the supported period preset to the authenticated API', () => {
    const client = readFileSync('src/utils/adminPlatformEconomy.ts', 'utf8');
    assert.match(client, /AdminPlatformEconomyPeriod/);
    assert.match(client, /URLSearchParams\(\{ period \}\)/);
    assert.match(client, /\/api\/admin\/platform-economy\?\$\{query\.toString\(\)\}/);
    assert.doesNotMatch(client, /occurredAt|createdAt|Timestamp/);
  });
});
