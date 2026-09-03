import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const diagnosticService = readFileSync(
  'server/inventory/canonicalInventoryAuthorityDiagnosticService.ts',
  'utf8'
);
const orderDiagnosticService = readFileSync(
  'server/integrations/ninetyNineFoodAuthorityDiagnosticService.ts',
  'utf8'
);
const router = readFileSync(
  'server/integrations/ninetyNineFoodRouter.ts',
  'utf8'
);
const client = readFileSync(
  'src/utils/storeChannelOperations.ts',
  'utf8'
);
const queue = readFileSync(
  'src/components/store/StoreChannelOperationsQueue.tsx',
  'utf8'
);

test('canonical authority diagnostic classifies exact owner cardinality and physical document existence', () => {
  assert.match(diagnosticService, /where\('role', '==', 'owner'\)/);
  assert.match(diagnosticService, /data\.status === 'active'/);
  assert.match(diagnosticService, /clean\(data\.userId\) === document\.id/);
  assert.match(diagnosticService, /state: 'no_active_owner'/);
  assert.match(diagnosticService, /state: 'multiple_active_owners'/);
  assert.match(diagnosticService, /state: inventoryDocumentExists \? 'resolved' : 'inventory_document_missing'/);
  assert.match(diagnosticService, /inventoryDocumentPathForOwner\(activeOwners\[0\]\.id\)/);
});

test('canonical authority diagnostic is read-only and never falls back to legacy authority', () => {
  assert.doesNotMatch(
    diagnosticService,
    /\.set\(|\.update\(|\.create\(|\.delete\(|batch\(|commit\(|FieldValue|legacyTenantInventoryAuthority/
  );
});

test('99Food authority diagnostic is tenant and blocked-order scoped before inspecting membership', () => {
  const scopeIndex = orderDiagnosticService.indexOf("inventoryReservationState(order) !== 'blocked_authority_unresolved'");
  const diagnosticIndex = orderDiagnosticService.indexOf('diagnoseCanonicalInventoryAuthority(canonicalStoreId)');
  assert.match(orderDiagnosticService, /requestedByUserId !== tenantId/);
  assert.match(orderDiagnosticService, /integrationProvider\(order\) !== '99food'/);
  assert.ok(scopeIndex >= 0);
  assert.ok(diagnosticIndex > scopeIndex);
  assert.match(orderDiagnosticService, /NINETY_NINE_FOOD_BLOCK_AUTHORITY_DIAGNOSTIC_NOT_APPLICABLE/);
});

test('99Food authority diagnostic projection exposes no member identity or private inventory path', () => {
  const projection = orderDiagnosticService.match(
    /return \{\n    orderId,[\s\S]*?\n  \};/
  )?.[0] ?? '';
  assert.match(projection, /activeOwnerCount/);
  assert.match(projection, /inventoryDocumentExists/);
  assert.match(projection, /checkedAt/);
  assert.doesNotMatch(projection, /ownerUserId|userId|email|name|inventoryDocumentPath|canonicalStoreId/);
});

test('authority diagnostic API is an authenticated GET separated from reservation retry', () => {
  assert.match(router, /router\.get\('\/blocked-orders\/:orderId\/authority-diagnostic'/);
  assert.match(router, /authenticatedTenantId\(request\)/);
  assert.match(router, /diagnoseNinetyNineFoodBlockedOrderInventoryAuthority/);
  assert.match(router, /router\.post\('\/blocked-orders\/:orderId\/retry-reservation'/);
  assert.match(router, /NINETY_NINE_FOOD_BLOCK_AUTHORITY_DIAGNOSTIC_NOT_APPLICABLE/);
});

test('client authority diagnostic uses GET only and exposes no write option', () => {
  const section = client.match(
    /export const diagnoseNinetyNineFoodBlockedOrderInventoryAuthority[\s\S]*?\n};/
  )?.[0] ?? '';
  assert.match(section, /authority-diagnostic/);
  assert.doesNotMatch(section, /method:\s*'POST'|method:\s*'PUT'|method:\s*'PATCH'|method:\s*'DELETE'/);
});

test('authority diagnostic UI distinguishes causes without automatic owner selection or retry', () => {
  assert.match(queue, /Diagnosticar autoridade/);
  assert.match(queue, /Nenhum owner ativo foi encontrado/);
  assert.match(queue, /Mais de um owner ativo foi encontrado/);
  assert.match(queue, /O documento físico canônico está ausente/);
  assert.match(queue, /A autoridade está resolvida nesta leitura/);
  assert.match(queue, /Use “Verificar ATP”/);

  const resolvedBlock = queue.match(
    /authorityDiagnostic\.state === 'resolved'[\s\S]*?<\/\>/
  )?.[0] ?? '';
  assert.doesNotMatch(
    resolvedBlock,
    /retryNinetyNineFoodBlockedOrderReservation|setConfirmRetryOrderId|requestPhysicalInventoryFocus|requestNinetyNineFoodBindingRemediation/
  );
});

test('authority diagnostic services never write provider status or mutate store authority', () => {
  const combined = `${diagnosticService}\n${orderDiagnosticService}`;
  assert.doesNotMatch(
    combined,
    /sendNinetyNineFoodOrderStatus|provider_write|transaction\.set|transaction\.create|\.update\(|\.delete\(/
  );
});
