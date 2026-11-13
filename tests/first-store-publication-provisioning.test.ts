import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

test('Free provisioning does not invoke first-store XP reward on creation', () => {
  const source = readFileSync(new URL('../server/actions/freeStoreProvisioningService.ts', import.meta.url), 'utf8');
  assert.doesNotMatch(source, /awardFirstStoreChallengeForCanonicalStore\s*\(/);
  assert.match(source, /activateStoreAfterProvisioning\(uid, provisioned\.plan\)/);
  assert.match(source, /activatePendingOfficialPlanForStore/);
});

test('publication contract remains separate from legacy creation challenge', () => {
  const source = readFileSync(new URL('../server/gamification/firstStorePublishedReward.ts', import.meta.url), 'utf8');
  assert.match(source, /first_store_published/);
  assert.match(source, /isMarketplaceVisible/);
  assert.match(source, /isFirstPublication/);
});
