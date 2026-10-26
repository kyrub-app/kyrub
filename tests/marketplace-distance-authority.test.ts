import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

test('marketplace distance logic is shared and never requires coordinates when disabled', () => {
  const helper = readFileSync('src/utils/marketplaceDistanceFilter.ts', 'utf8');
  const active = readFileSync('src/components/tabs/LegacyKyrubTab.tsx', 'utf8');

  assert.match(helper, /if \(!enabled \|\| !userCoords\) return true/);
  assert.match(helper, /Number\.isFinite\(store\.lat\)/);
  assert.match(helper, /Number\.isFinite\(store\.lng\)/);
  assert.match(helper, /Number\.isFinite\(distance\) && distance <= radiusKm/);
  assert.match(active, /matchesMarketplaceDistance\(store, distanceFilterEnabled, effectiveUserCoords, radiusKm, getDistance\)/);
  assert.match(active, /setDistanceFilterEnabled\(false\); setIsDistancePanelOpen\(false\)/);
});

test('marketplace listing adapters do not fabricate novelty metadata', () => {
  const tab = readFileSync('src/components/tabs/KyrubTab.tsx', 'utf8');
  assert.match(tab, /const canonicalListingToStore/);
  assert.match(tab, /const tenantListingToStore/);
  assert.match(tab, /isNew: false/);
});
