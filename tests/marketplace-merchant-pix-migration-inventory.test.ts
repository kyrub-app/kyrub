import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
const read = (path: string) => readFileSync(path, 'utf8');

test('migration inventory is a super-admin-only, GET-only, cache-free transport', () => {
  const router = read('server/admin/operationsHealthRouter.ts');
  const getBlock = router.split("router.get('/', async")[1]?.split("router.post('/', async")[0] ?? '';
  const inventory = getBlock.split("if (transport === 'mercado-pago-migration-inventory')")[1]
    ?.split("if (transport === 'customer-arrival-policy')")[0] ?? '';
  assert.match(inventory, /await authorizeIntegrationReadiness\(request\.get\('authorization'\) \?\? ''\)/);
  assert.match(inventory, /Cache-Control', 'no-store, max-age=0'/);
  assert.match(inventory, /loadMercadoPagoMerchantPixMigrationInventory\(\)/);
  assert.doesNotMatch(inventory, /loadMercadoPagoStoreTokenSecret|decryptIntegrationSecret|createStoreScopedMercadoPagoMarketplacePix/);
  const post = router.split("router.post('/', async")[1] ?? '';
  assert.doesNotMatch(post, /mercado-pago-migration-inventory/);
});

test('published-store inventory is bounded, identity-checked, and never treats metadata as live authorization', () => {
  const inventory = read('server/admin/mercadoPagoMerchantPixMigrationInventoryService.ts');
  assert.match(inventory, /MAX_PUBLISHED_STORES = 50/);
  assert.match(inventory, /\.where\('publicationStatus', '==', 'published'\)/);
  assert.match(inventory, /\.limit\(MAX_PUBLISHED_STORES \+ 1\)/);
  assert.match(inventory, /const complete = tenants\.size <= MAX_PUBLISHED_STORES/);
  assert.match(inventory, /\.where\('legacyTenantId', '==', tenantId\)\.limit\(2\)/);
  assert.match(inventory, /getPrimaryUserStoreDocumentPath\(tenantId\)/);
  assert.match(inventory, /loadMercadoPagoStoreConnectionMetadata\(ownerId\)/);
  assert.match(inventory, /metadata\.externalAccountId\.slice\(-4\)/);
  assert.match(inventory, /needsLivePreflight: true/);
  assert.match(inventory, /requiresOperationalSalesReview: true/);
  assert.doesNotMatch(inventory, /mercadoPagoStoreRequest|loadMercadoPagoStoreTokenSecret|decryptIntegrationSecret|accessToken|refreshToken|runTransaction|\.update\(|\.set\(/);
});

test('store inventory reports prepared vs blocked, not a payment settled flag', () => {
  const inventory = read('server/admin/mercadoPagoMerchantPixMigrationInventoryService.ts');
  assert.match(inventory, /identity_review/);
  assert.match(inventory, /connection_review/);
  assert.match(inventory, /oauth_required/);
  assert.match(inventory, /oauth_connected_rollout_pending/);
  assert.match(inventory, /oauth_connected_rollout_enabled/);
  assert.match(inventory, /isMercadoPagoMerchantPixRolloutAllowed\(canonicalStoreId, env\)/);
  assert.doesNotMatch(inventory, /payment\.paid|payment\.approved|payment\.refunded|paymentCompleted/);
});

test('inventory is visible only inside the existing admin integrations workspace, not as a second finance panel', () => {
  const workspace = read('src/components/admin/AdminIntegrationsWorkspace.tsx');
  const card = read('src/components/admin/AdminMercadoPagoMigrationInventoryCard.tsx');
  assert.match(workspace, /AdminMercadoPagoOAuthCard user=\{authenticatedUser\}/);
  assert.match(workspace, /AdminMercadoPagoMigrationInventoryCard user=\{authenticatedUser\}/);
  assert.match(workspace, /profile\.role !== 'super_admin'/);
  assert.match(card, /\/api\/admin\/operations\/health\?transport=mercado-pago-migration-inventory/);
  assert.match(card, /data\.error|Inventário Mercado Pago indisponível/);
  assert.match(card, /snapshot\.complete/);
  assert.match(card, /snapshot\.items\.map/);
  assert.match(card, /Este inventário NÃO autoriza merge, Pix ou migração automática/);
  assert.doesNotMatch(card, /Access Token|Client Secret|\.post\(|method: 'POST'/);
});
