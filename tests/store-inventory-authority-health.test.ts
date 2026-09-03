import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const service = readFileSync(
  'server/integrations/storeInventoryAuthorityHealthService.ts',
  'utf8'
);
const router = readFileSync(
  'server/integrations/storeConnectionOnboardingRouter.ts',
  'utf8'
);
const client = readFileSync(
  'src/utils/storeInventoryAuthorityHealth.ts',
  'utf8'
);
const center = readFileSync(
  'src/components/store/StoreChannelCenter.tsx',
  'utf8'
);

test('store authority health resolves canonical store through tenant before inspecting inventory authority', () => {
  const tenantIndex = service.indexOf('adminDb.doc(`tenants/${tenantId}`)');
  const canonicalIndex = service.indexOf('tenant.data()?.canonicalStoreId');
  const diagnosticIndex = service.indexOf('diagnoseCanonicalInventoryAuthority(canonicalStoreId)');
  assert.ok(tenantIndex >= 0);
  assert.ok(canonicalIndex > tenantIndex);
  assert.ok(diagnosticIndex > canonicalIndex);
  assert.match(service, /state: 'canonical_store_unresolved'/);
  assert.doesNotMatch(service, /diagnoseCanonicalInventoryAuthority\(tenantId\)/);
});

test('preventive store authority health is owner scoped, read-only and has no legacy fallback', () => {
  assert.match(service, /requestedByUserId !== tenantId/);
  assert.doesNotMatch(
    service,
    /\.set\(|\.update\(|\.create\(|\.delete\(|batch\(|commit\(|legacyTenantInventoryAuthority|FieldValue/
  );
});

test('store connections router exposes authority health as authenticated no-store GET', () => {
  assert.match(router, /router\.get\('\/:storeId\/inventory-authority-health'/);
  assert.match(router, /authenticatedOwner\(request\.get\('authorization'\) \?\? '', storeId\)/);
  assert.match(router, /loadStoreInventoryAuthorityHealth/);
  assert.match(router, /Cache-Control', 'no-store, max-age=0'/);
  assert.match(router, /STORE_INVENTORY_AUTHORITY_FORBIDDEN/);
});

test('browser authority health helper performs GET only', () => {
  assert.match(client, /inventory-authority-health/);
  assert.match(client, /method: 'GET'/);
  assert.match(client, /cache: 'no-store'/);
  assert.doesNotMatch(client, /method:\s*'POST'|method:\s*'PUT'|method:\s*'PATCH'|method:\s*'DELETE'/);
});

test('Channel Center keeps channel registry and authority health as independent read-only sources', () => {
  assert.match(center, /Promise\.allSettled/);
  assert.match(center, /loadStoreConnectionOnboarding\(user, storeId\)/);
  assert.match(center, /loadStoreInventoryAuthorityHealth\(user, storeId\)/);
  assert.match(center, /id="kyrub-inventory-authority-health"/);
  assert.match(center, /Verificação preventiva e somente leitura/);
  assert.match(center, /Não altera owner, membership, inventário, reservas nem canais externos/);
});

test('Channel Center explains all authority health states without a mutation CTA', () => {
  assert.match(center, /Loja canônica pendente/);
  assert.match(center, /Sem owner ativo/);
  assert.match(center, /Múltiplos owners/);
  assert.match(center, /Inventário físico ausente/);
  assert.match(center, /label: 'Pronta'/);
  assert.match(center, /O Kyrub não escolherá um deles por aproximação/);

  const healthCard = center.match(
    /<div id="kyrub-inventory-authority-health"[\s\S]*?<\/div>\n\n      <div className="mt-4 grid gap-2/
  )?.[0] ?? '';
  assert.doesNotMatch(
    healthCard,
    /<button|onClick|retry|requestPhysicalInventoryFocus|requestNinetyNineFoodBindingRemediation|updateStoreConnectionSyncAuthority/
  );
});
