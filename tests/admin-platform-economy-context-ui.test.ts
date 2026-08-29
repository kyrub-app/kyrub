import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { describe, test } from 'node:test';

describe('admin platform economy context UI', () => {
  test('workspace exposes canonical Marketplace, Mesa and PDV context totals', () => {
    const workspace = readFileSync(
      'src/components/admin/AdminPlatformEconomyWorkspace.tsx',
      'utf8'
    );

    assert.match(workspace, /AdminPlatformEconomyPaymentContext/);
    assert.match(workspace, /case 'marketplace':\s*return 'Marketplace'/);
    assert.match(workspace, /case 'table':\s*return 'Mesa'/);
    assert.match(workspace, /case 'pos':\s*return 'PDV'/);
    assert.match(workspace, /Economia por canal/);
    assert.match(workspace, /snapshot\.contextTotals\.map/);
    assert.match(workspace, /context\.economicNetMinor/);
    assert.match(workspace, /context\.eventCount/);
    assert.match(workspace, /storeScopeLabel/);
    assert.match(workspace, /periodLabel\(period\)/);
    assert.doesNotMatch(workspace, /currentPlan|store\.plan|planId/);
  });

  test('context projection contract keeps exactly the three frozen payment contexts', () => {
    const contract = readFileSync('shared/adminPlatformEconomy.ts', 'utf8');

    assert.match(
      contract,
      /ADMIN_PLATFORM_ECONOMY_CONTEXTS = \['marketplace', 'table', 'pos'\] as const/
    );
    assert.match(contract, /contextTotals: AdminPlatformEconomyContextTotal\[\]/);
    assert.match(contract, /paymentContext: AdminPlatformEconomyPaymentContext/);
    assert.match(contract, /economicNetMinor: number/);
  });
});
