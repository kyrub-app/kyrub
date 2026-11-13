import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const read = (path: string) => readFileSync(new URL(path, import.meta.url), 'utf8');

test('UI publication is client-side and must not be treated as verified reward evidence', () => {
  const modal = read('../src/components/modals/StoreConfigModal.tsx');
  const persistence = read('../src/utils/storePersistence.ts');
  assert.match(modal, /await setStoreMarketplacePublication\(/);
  assert.match(persistence, /await persistCanonicalMarketplaceListing\(/);
  assert.match(persistence, /await persistTenantMarketplaceFallback\(/);
  assert.doesNotMatch(persistence, /awardVerifiedFirstStorePublicationInTransaction/);
});

test('server reward verifier requires immutable first-publication marker and marketplace listing', () => {
  const source = read('../server/gamification/firstStorePublishedVerificationService.ts');
  assert.match(source, /verifiedStoreEvents\/first_store_published/);
  assert.match(source, /firstPublishedAt/);
  assert.match(source, /marketplace_listings/);
  assert.match(source, /awardVerifiedFirstStorePublicationInTransaction/);
});

test('Free provisioning must never grant XP during store creation', () => {
  const source = read('../server/actions/freeStoreProvisioningService.ts');
  assert.doesNotMatch(source, /awardFirstStoreChallengeForCanonicalStore\s*\(/);
});

test('primary marketplace listing maps to owner UID, not canonical store document ID', () => {
  const source = read('../server/gamification/firstStorePublishedVerificationService.ts');
  assert.match(source, /listingId = `s_\$\{userId\.length\}_\$\{userId\}`/);
  assert.match(source, /listings\.get\('storeId'\) === userId/);
  assert.match(source, /listings\.get\('ownerId'\) === userId/);
  assert.match(source, /store\.get\('id'\) !== canonicalStoreId/);
});
