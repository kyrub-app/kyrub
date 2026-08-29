import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { describe, test } from 'node:test';
import {
  ADMIN_PLATFORM_ECONOMY_CONTEXTS,
  type AdminPlatformEconomyPaymentContext,
} from '../shared/adminPlatformEconomy';

describe('admin platform economy payment context dimension', () => {
  test('keeps canonical payment contexts closed and explicit', () => {
    assert.deepEqual(ADMIN_PLATFORM_ECONOMY_CONTEXTS, ['marketplace', 'table', 'pos']);
    const contexts: AdminPlatformEconomyPaymentContext[] = [...ADMIN_PLATFORM_ECONOMY_CONTEXTS];
    assert.equal(contexts.length, 3);
  });

  test('server derives context totals from the already-scoped economic ledger', () => {
    const service = readFileSync('server/admin/platformEconomyService.ts', 'utf8');
    assert.match(service, /ADMIN_PLATFORM_ECONOMY_CONTEXTS\.map/);
    assert.match(service, /ledger\.where\('paymentContext', '==', paymentContext\)/);
    assert.match(service, /AggregateField\.sum\('amountMinor'\)/);
    assert.match(service, /contextQuery\.count\(\)\.get\(\)/);
    assert.match(service, /economicNetMinor: safeAggregateInteger/);
    assert.match(service, /contextTotals,/);
  });

  test('context projection does not classify history by current store plan', () => {
    const service = readFileSync('server/admin/platformEconomyService.ts', 'utf8');
    assert.doesNotMatch(service, /where\('plan',/);
    assert.doesNotMatch(service, /store_entitlements/);
  });
});
