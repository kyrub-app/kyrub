import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const service = readFileSync(
  'server/integrations/storeInventoryAuthorityRepairService.ts',
  'utf8'
);
const router = readFileSync(
  'server/integrations/storeConnectionOnboardingRouter.ts',
  'utf8'
);
const client = readFileSync(
  'src/utils/storeInventoryAuthorityRepair.ts',
  'utf8'
);
const panel = readFileSync(
  'src/components/store/StoreInventoryAuthorityRepairPanel.tsx',
  'utf8'
);
const bridge = readFileSync(
  'src/components/store/StoreConnectionsPortalBridge.tsx',
  'utf8'
);

test('repair requires institutional, tenant and canonical root ownership to align exactly', () => {
  assert.match(service, /clean\(privateStore\?\.ownerId\) !== tenantId/);
  assert.match(service, /clean\(tenant\?\.ownerId\) !== tenantId/);
  assert.match(service, /canonicalOwnerId !== tenantId/);
  assert.match(service, /legacyTenantId && legacyTenantId !== tenantId/);
  assert.match(service, /tenantCanonicalStoreId && privateCanonicalStoreId && tenantCanonicalStoreId !== privateCanonicalStoreId/);
});

test('unresolved canonical store repair uses only an explicit existing private link', () => {
  assert.match(service, /privateCanonicalStoreId = clean\(privateStore\?\.canonicalStoreId\)/);
  assert.match(service, /canonicalStoreId = tenantCanonicalStoreId \|\| privateCanonicalStoreId/);
  assert.match(service, /action: 'link_existing_canonical_store'/);
  assert.doesNotMatch(service, /where\(['"]name['"]|normalizeName|localeCompare|toLocaleLowerCase|recoveryCanonicalStoreId|createHash\('sha256'\)\.update\(uid\)/);
});

test('active owners without the canonical root owner are classified before multiple-owner governance', () => {
  const mismatchIndex = service.indexOf('if (!activeOwnerIds.includes(canonicalOwnerId))');
  const multipleIndex = service.indexOf('if (activeOwnerIds.length > 1)', mismatchIndex);

  assert.ok(mismatchIndex >= 0);
  assert.ok(multipleIndex > mismatchIndex);
  assert.match(service, /state: 'canonical_owner_not_active'/);
  assert.match(service, /reason: 'canonical_owner_mismatch'/);
  assert.match(service, /activeOwnerCount: activeOwnerIds\.length/);
  assert.match(client, /'canonical_owner_not_active'/);
  assert.doesNotMatch(service, /if \(activeOwnerIds\[0\] !== canonicalOwnerId\)/);
});

test('multiple active owners mean canonical owner plus additional owners and remain non-actionable', () => {
  const canonicalPresenceIndex = service.indexOf('if (!activeOwnerIds.includes(canonicalOwnerId))');
  const multipleIndex = service.indexOf('if (activeOwnerIds.length > 1)', canonicalPresenceIndex);
  assert.ok(canonicalPresenceIndex >= 0);
  assert.ok(multipleIndex > canonicalPresenceIndex);
  assert.match(service, /reason: 'multiple_active_owners'/);
  assert.match(panel, /Este painel não escolhe nem desativa nenhum deles/);
  assert.doesNotMatch(service, /activeOwnerIds\[0\][\s\S]{0,120}activate_canonical_owner/);
});

test('zero-owner repair blocks when the canonical membership path belongs to another explicit identity', () => {
  const zeroOwnerIndex = service.indexOf('if (activeOwnerIds.length === 0)');
  const memberReadIndex = service.indexOf('canonicalOwnerMemberSnapshot = await reader.get(canonicalOwnerMemberRef)');
  const conflictIndex = service.indexOf("reason: 'canonical_owner_identity_conflict'");
  const activationIndex = service.indexOf("action: 'activate_canonical_owner'", conflictIndex);

  assert.ok(zeroOwnerIndex >= 0);
  assert.ok(memberReadIndex > zeroOwnerIndex);
  assert.ok(conflictIndex > memberReadIndex);
  assert.ok(activationIndex > conflictIndex);
  assert.match(service, /existingCanonicalMemberUserId !== canonicalOwnerId/);
  assert.match(client, /'canonical_owner_identity_conflict'/);
  assert.match(panel, /já aponta explicitamente para outra identidade/);
  assert.match(panel, /não substituirá esse userId por merge/);
});

test('owner activation revalidates membership identity before its merge write', () => {
  const activationBranch = service.match(
    /preview\.action === 'activate_canonical_owner'[\s\S]*?transaction\.set\(\n        ownerMemberRef,[\s\S]*?\n      \);/
  )?.[0] ?? '';
  const snapshotIndex = activationBranch.indexOf('ownerMemberSnapshot = await transaction.get(ownerMemberRef)');
  const conflictIndex = activationBranch.indexOf('existingOwnerMemberUserId !== context.canonicalOwnerId');
  const writeIndex = activationBranch.indexOf('transaction.set(');

  assert.ok(snapshotIndex >= 0);
  assert.ok(conflictIndex > snapshotIndex);
  assert.ok(writeIndex > conflictIndex);
  assert.match(activationBranch, /STORE_INVENTORY_AUTHORITY_REPAIR_NOT_ACTIONABLE/);
  assert.match(activationBranch, /userId: context\.canonicalOwnerId/);
});

test('owner activation is restricted to the canonical root owner id', () => {
  assert.match(service, /canonicalOwnerId = clean\(canonicalStore\?\.ownerId\)/);
  assert.match(service, /members\/\$\{context\.canonicalOwnerId\}/);
  assert.match(service, /userId: context\.canonicalOwnerId/);
  assert.match(service, /role: 'owner'/);
  assert.match(service, /status: 'active'/);
  assert.doesNotMatch(service, /role:\s*['"]manager['"]|role:\s*['"]staff['"]/);
});

test('inventory initialization creates structure only and invents no physical quantity', () => {
  assert.match(service, /action: 'initialize_empty_inventory'/);
  assert.match(service, /inventoryCatalog: \[\]/);
  assert.match(service, /catalog: \[\]/);
  assert.match(service, /recentInventoryMovements: \[\]/);
  assert.doesNotMatch(
    service,
    /currentQuantity\s*:|minimumQuantity\s*:|quantity\s*:|stock\s*:/
  );
});

test('repair preview is fingerprinted and confirmation revalidates inside a transaction', () => {
  assert.match(service, /repairIdFor/);
  assert.match(service, /activeOwnerIds: \[\.\.\.input\.activeOwnerIds\]\.sort\(\)/);
  assert.match(service, /inventoryDocumentExists: input\.inventoryDocumentExists/);
  assert.match(service, /if \(!input\.confirmed\) throw new Error\('STORE_INVENTORY_AUTHORITY_REPAIR_CONFIRMATION_REQUIRED'\)/);
  assert.match(service, /adminDb\.runTransaction/);
  assert.match(service, /inspectRepairContext\([\s\S]*transaction\.get/);
  assert.match(service, /preview\.repairId !== expectedRepairId/);
  assert.match(service, /STORE_INVENTORY_AUTHORITY_REPAIR_STALE/);
});

test('router keeps preview GET and confirmed repair POST as separate authenticated contracts', () => {
  assert.match(router, /router\.get\('\/:storeId\/inventory-authority-repair'/);
  assert.match(router, /loadStoreInventoryAuthorityRepairPreview/);
  assert.match(router, /router\.post\('\/:storeId\/inventory-authority-repair'/);
  assert.match(router, /applyStoreInventoryAuthorityRepair/);
  assert.match(router, /confirmed: request\.body\?\.confirmed === true/);
  assert.match(router, /repairId: clean\(request\.body\?\.repairId\)/);
  assert.match(router, /STORE_INVENTORY_AUTHORITY_REPAIR_STALE/);
});

test('browser flow is explicitly two-step and persists no repair grant locally', () => {
  assert.match(client, /method: 'GET'/);
  assert.match(client, /method: 'POST'/);
  assert.match(client, /confirmed: true/);
  assert.match(client, /repairId: preview\.repairId/);
  assert.doesNotMatch(client, /localStorage|sessionStorage|indexedDB|Firestore/i);
  assert.match(panel, /Preparar correção segura/);
  assert.match(panel, /confirmStoreInventoryAuthorityRepair\(user, storeId, preview\)/);
  assert.match(panel, /Confirmar vínculo canônico|Confirmar owner canônico|Confirmar inventário vazio/);
});

test('authority repair never mutates provider state, retries reservations or invents binding', () => {
  const combined = service + client + panel;
  assert.doesNotMatch(
    combined,
    /sendNinetyNineFoodOrderStatus|retryNinetyNineFoodBlockedOrderReservation|bindNinetyNineFoodProduct|MercadoLivre.*write|provider_write/i
  );
  assert.match(panel, /não executa reserva e não envia status a canais externos/i);
});

test('successful confirmed repair reconsults store health, queue and physical inventory views', () => {
  assert.match(bridge, /authorityRefreshVersion/);
  assert.match(bridge, /setAuthorityRefreshVersion\(version => version \+ 1\)/);
  assert.match(bridge, /key=\{`channel-center-\$\{storeViewRefreshVersion\}`\}/);
  assert.match(bridge, /key=\{`channel-operations-\$\{storeViewRefreshVersion\}`\}/);
  assert.match(bridge, /key=\{`physical-inventory-\$\{storeViewRefreshVersion\}`\}/);
});
