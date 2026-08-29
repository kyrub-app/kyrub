import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { describe, test } from 'node:test';

describe('admin platform economy historical plan UI', () => {
  test('workspace exposes immutable historical plan buckets and legacy gap explicitly', () => {
    const workspace = readFileSync('src/components/admin/AdminPlatformEconomyWorkspace.tsx', 'utf8');
    const contract = readFileSync('shared/adminPlatformEconomy.ts', 'utf8');
    const service = readFileSync('server/admin/platformEconomyService.ts', 'utf8');

    assert.match(contract, /ADMIN_PLATFORM_ECONOMY_PLAN_BUCKETS = \['free', 'pro', 'business', 'unsnapshotted'\]/);
    assert.match(contract, /planTotals: AdminPlatformEconomyPlanTotal\[\]/);
    assert.match(service, /where\('storePlan', '==', plan\)/);
    assert.match(service, /unsnapshottedEventCount/);
    assert.match(service, /unsnapshottedEconomicNetMinor/);
    assert.match(service, /PLAN_CONSERVATION_INVALID/);
    assert.doesNotMatch(service, /storeSnapshot.*planTotals|currentPlan.*planTotals/i);

    assert.match(workspace, /Economia por plano histórico/);
    assert.match(workspace, /Free · Pro · Business · Sem snapshot/);
    assert.match(workspace, /snapshot\.planTotals\.map/);
    assert.match(workspace, /legado anterior a essa autoridade/);
    assert.match(workspace, /nunca é preenchido com o plano atual/);
    assert.match(workspace, /entry\.storePlan \? planLabel\(entry\.storePlan\) : 'Sem snapshot'/);
  });
});
