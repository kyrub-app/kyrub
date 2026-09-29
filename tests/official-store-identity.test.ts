import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const canonicalResolver = readFileSync(
  'server/identity/canonicalStoreIdentityService.ts',
  'utf8'
);
const officialService = readFileSync(
  'server/admin/officialStoreService.ts',
  'utf8'
);
const gateway = readFileSync('api/plan-control.ts', 'utf8');
const client = readFileSync('src/utils/officialStore.ts', 'utf8');
const panel = readFileSync(
  'src/components/store/OfficialStoreIdentityPanel.tsx',
  'utf8'
);
const promotions = readFileSync(
  'src/components/store/PromotionalDirectRuntime.tsx',
  'utf8'
);

test('Official Cairobi Store is a protected singleton independent from courtesy entitlements', () => {
  assert.match(officialService, /kyrub_admin\/official_store/);
  assert.match(officialService, /official_cairobi_store/);
  assert.match(officialService, /admin\.role !== 'super_admin'/);
  assert.match(officialService, /authorizeOperationsHealth/);
  assert.match(officialService, /runTransaction/);
  assert.match(officialService, /admin\.official_store\.designated/);
  assert.match(officialService, /admin\.official_store\.reassigned/);
  assert.doesNotMatch(officialService, /courtesy|cortesia|complimentary|entitlement/i);
});

test('Official Store resolves the same canonical store identity shape used by commerce', () => {
  assert.match(canonicalResolver, /stores\/\$\{input\}/);
  assert.match(canonicalResolver, /where\('legacyTenantId', '==', input\)/);
  assert.match(canonicalResolver, /data\.ownerId/);
  assert.match(canonicalResolver, /legacyStoreId !== ownerUserId/);
  assert.match(canonicalResolver, /tenants\/\$\{legacyStoreId\}/);
  assert.match(canonicalResolver, /publicationStatus/);
  assert.match(officialService, /resolveCanonicalStoreIdentity/);
});

test('reassigning the singleton requires an explicit server-validated confirmation', () => {
  assert.match(officialService, /replaceExisting === true/);
  assert.match(officialService, /OFFICIAL_STORE_REPLACEMENT_CONFIRMATION_REQUIRED/);
  assert.match(officialService, /current && !replaceExisting/);
  assert.match(officialService, /current\?\.canonicalStoreId === candidate\.canonicalStoreId/);
});

test('plan-control reuses the existing serverless multiplexer for Official Store authority', () => {
  assert.match(gateway, /admin\.official-store\.snapshot/);
  assert.match(gateway, /loadOfficialStoreSnapshot/);
  assert.match(gateway, /admin\.official-store\.designate/);
  assert.match(gateway, /designateOfficialStore/);
});

test('browser sends only active store reference and replacement intent, never canonical authority', () => {
  assert.match(client, /JSON\.stringify\(\{ storeId, replaceExisting \}\)/);
  assert.doesNotMatch(client, /JSON\.stringify\(\{[^}]*canonicalStoreId/);
  assert.match(panel, /window\.confirm/);
  assert.match(panel, /Designar esta loja como oficial/);
  assert.match(panel, /Substituir pela loja atual/);
  assert.match(panel, /não é inferida por cortesia, nome, slug ou e-mail/);
});

test('Official Store identity lives inside the protected Cairobi Official store workspace', () => {
  assert.match(promotions, /OfficialStoreIdentityPanel/);
  assert.match(promotions, /authenticatedUser=\{user\} storeId=\{storeId\}/);
  assert.match(promotions, /adminProfile\.role === 'super_admin'/);
  assert.match(promotions, /Cairubi Oficial/);
});
