import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import {
  KYRUB_OFFICIAL_STORE_PLANS_URL,
  getOfficialStorePlansUrl,
} from '../src/utils/officialStorePlansNavigation';
import { resolveKyrubAppRoute } from '../src/utils/appRoutes';
import { isPlanCenterLocation } from '../src/utils/planCenter';
import {
  canStoreRoleAccessErpMenuItem,
  commitMobileErpMenuSelection,
} from '../src/components/MobileErpMenu';

test('canonical plan purchase destination is the public Official Kyrub storefront', () => {
  assert.equal(
    KYRUB_OFFICIAL_STORE_PLANS_URL,
    'https://www.kyrub.com/@kyrub-oficial'
  );
  assert.equal(getOfficialStorePlansUrl(), KYRUB_OFFICIAL_STORE_PLANS_URL);
  const url = new URL(getOfficialStorePlansUrl());
  assert.equal(url.origin, 'https://www.kyrub.com');
  assert.deepEqual(resolveKyrubAppRoute(url.pathname), {
    kind: 'public-storefront',
    slug: 'kyrub-oficial',
    canonicalPath: '/@kyrub-oficial',
  });
});

test('Planos button sends owner straight to the Official Store, never to legacy Plan Center', () => {
  assert.equal(canStoreRoleAccessErpMenuItem('owner', 'planos'), true);
  assert.equal(canStoreRoleAccessErpMenuItem('seller', 'planos'), false);

  const calls: string[] = [];
  commitMobileErpMenuSelection('planos', {
    onOpenOfficialStorePlans: () => calls.push(getOfficialStorePlansUrl()),
    onOpenStoreConfig: () => calls.push('store-config'),
    onSelectTab: tab => calls.push('tab:' + tab),
    onSelectManagementModule: module => calls.push('module:' + module),
  });
  assert.deepEqual(calls, ['module:null', 'https://www.kyrub.com/@kyrub-oficial']);
});

test('both ERP menu runtimes and profile billing shortcut share the Official Store destination', () => {
  const canonical = readFileSync('src/components/MobileErpMenu.tsx', 'utf8');
  const runtime = readFileSync('src/components/MobileErpMenuRuntime.tsx', 'utf8');
  const profile = readFileSync('src/components/ProfilePlanCenterBridge.tsx', 'utf8');

  for (const file of [canonical, runtime]) {
    assert.match(file, /window\.location\.assign\(getOfficialStorePlansUrl\(\)\)/);
    assert.doesNotMatch(file, /getPlanCenterUrl|planos\.kyrub\.com/);
  }
  assert.match(profile, /href=\{getOfficialStorePlansUrl\(\)\}/);
  assert.match(profile, /Abrir Loja Oficial Kyrub/);
  assert.doesNotMatch(profile, /getPlanCenterUrl|Abrir Central de Planos/);
});

test('the legacy Plan Center domain and route remain separate for future reuse', () => {
  assert.equal(isPlanCenterLocation('planos.kyrub.com', '/'), true);
  assert.equal(isPlanCenterLocation('www.kyrub.com', '/@kyrub-oficial'), false);
  const app = readFileSync('src/App.tsx', 'utf8');
  assert.match(app, /if \(planCenter\) return <PlanCenterApp \/>/);
  const profile = readFileSync('src/components/ProfilePlanCenterBridge.tsx', 'utf8');
  assert.doesNotMatch(profile, /getPlanCenterUrl/);
  assert.equal(getOfficialStorePlansUrl().includes('planos.kyrub.com'), false);
});
