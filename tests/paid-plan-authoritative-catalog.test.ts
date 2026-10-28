import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { describe, it } from 'node:test';

describe('paid platform plan checkout requires authoritative pricing', () => {
  const billing = readFileSync(
    new URL('../server/admin/paidPlanSubscriptionService.ts', import.meta.url), 'utf8'
  );
  const catalog = readFileSync(
    new URL('../server/admin/publicPlanCatalogService.ts', import.meta.url), 'utf8'
  );

  it('rejects compiled fallback prices for real paid plan checkout', () => {
    assert.match(billing, /entry\.source !== 'control_plane'/);
    assert.match(billing, /PLAN_NOT_BILLABLE/);
  });

  it('retains compiled fallback for public plan display only', () => {
    assert.match(catalog, /source: 'compiled_v1'/);
    assert.match(catalog, /source: 'control_plane'/);
  });
});
