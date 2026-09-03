import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const service = readFileSync(
  'server/integrations/storeOwnerGovernanceService.ts',
  'utf8'
);
const router = readFileSync(
  'server/integrations/storeConnectionOnboardingRouter.ts',
  'utf8'
);
const client = readFileSync(
  'src/utils/storeOwnerGovernance.ts',
  'utf8'
);
const panel = readFileSync(
  'src/components/store/StoreOwnerGovernancePanel.tsx',
  'utf8'
);
const bridge = readFileSync(
  'src/components/store/StoreConnectionsPortalBridge.tsx',
  'utf8'
);

test('owner governance requires private, tenant and canonical ownership to align exactly', () => {
  assert.ok(service.includes('clean(privateStore?.ownerId) !== tenantId'));
  assert.ok(service.includes('clean(tenant?.ownerId) !== tenantId'));
  assert.ok(service.includes('canonicalOwnerId !== tenantId'));
  assert.ok(service.includes('legacyTenantId && legacyTenantId !== tenantId'));
  assert.ok(service.includes('tenantCanonicalStoreId && privateCanonicalStoreId && tenantCanonicalStoreId !== privateCanonicalStoreId'));
  assert.doesNotMatch(service, /where\(['"]name['"]|normalizeName|localeCompare|toLocaleLowerCase\('pt-BR'\).*canonicalStore/i);
});

test('multiple-owner governance is actionable only while the canonical owner remains active', () => {
  assert.ok(service.includes("state: 'canonical_owner_not_active'"));
  assert.ok(service.includes('!activeOwnerIds.includes(canonicalOwnerId)'));
  assert.ok(service.includes("state: 'multiple_active_owners'"));
  assert.ok(service.includes('activeOwnerIds.filter(userId => userId !== canonicalOwnerId)'));
  assert.ok(panel.includes('Owner canônico protegido'));
});

test('browser preview exposes masked identity hints and opaque selections, never raw member ids', () => {
  assert.ok(service.includes('maskEmail'));
  assert.ok(service.includes('selectionIdFor'));
  assert.ok(service.includes("adminDb.doc(`users/${memberUserId}`)"));
  assert.ok(client.includes('displayName: string'));
  assert.ok(client.includes('emailHint: string'));
  assert.ok(client.includes('selectionId: string'));
  assert.doesNotMatch(client, /memberUserId|ownerUserId|selectedMemberUserId|\buserId\s*:/);
  assert.doesNotMatch(panel, /memberUserId|ownerUserId|selectedMemberUserId|\buserId\s*:/);
});

test('each decision deactivates exactly one additional owner and never invents a replacement role', () => {
  assert.ok(service.includes('selectedOwnerIds.length !== 1'));
  assert.ok(service.includes("status: 'inactive'"));
  assert.ok(service.includes("ownerAuthorityRevocationReason: 'canonical_owner_conflict_resolution'"));
  assert.ok(service.includes("action: 'deactivate_additional_owner_membership'"));
  assert.doesNotMatch(service, /role:\s*['"]manager['"]|role:\s*['"]attendant['"]|role:\s*['"]staff['"]/);
  assert.ok(panel.includes('Ela não transforma a pessoa em manager'));
  assert.ok(panel.includes('Cada owner adicional exige uma confirmação separada'));
});

test('canonical owner cannot be selected by the governance write', () => {
  assert.ok(service.includes('selectedOwnerId === context.canonicalOwnerId'));
  assert.ok(service.includes('STORE_OWNER_GOVERNANCE_CANONICAL_OWNER_PROTECTED'));
  assert.ok(service.includes('context.extraOwnerIds.filter'));
  assert.ok(panel.includes('não aparece como opção de remoção'));
});

test('governance confirmation is fingerprinted and stale conflicts are rejected transactionally', () => {
  assert.ok(service.includes('conflictIdFor'));
  assert.ok(service.includes('activeOwnerIds: [...input.activeOwnerIds].sort()'));
  assert.ok(service.includes('adminDb.runTransaction'));
  assert.ok(service.includes('inspectGovernanceContext(transactionReader(transaction), tenantId)'));
  assert.ok(service.includes('context.conflictId !== expectedConflictId'));
  assert.ok(service.includes('STORE_OWNER_GOVERNANCE_STALE'));
  assert.ok(service.includes("if (!input.confirmed) throw new Error('STORE_OWNER_GOVERNANCE_CONFIRMATION_REQUIRED')"));
});

test('router and browser keep review GET separate from confirmed decision POST', () => {
  assert.ok(router.includes("router.get('/:storeId/owner-governance'"));
  assert.ok(router.includes('loadStoreOwnerGovernancePreview'));
  assert.ok(router.includes("router.post('/:storeId/owner-governance'"));
  assert.ok(router.includes('applyStoreOwnerGovernanceDecision'));
  assert.ok(router.includes('confirmed: request.body?.confirmed === true'));
  assert.ok(client.includes("method: 'GET'"));
  assert.ok(client.includes("method: 'POST'"));
  assert.ok(client.includes('confirmed: true'));
  assert.doesNotMatch(client, /localStorage|sessionStorage|indexedDB|Firestore/i);
});

test('UI requires an explicit second confirmation for the exact additional owner', () => {
  assert.ok(panel.includes('Revisar remoção da autoridade'));
  assert.ok(panel.includes('armedSelectionId'));
  assert.ok(panel.includes('candidate.selectionId !== armedSelectionId'));
  assert.ok(panel.includes('Confirmar desativação deste owner adicional'));
  assert.ok(panel.includes('confirmStoreOwnerGovernanceDecision(user, storeId, preview, candidate)'));
});

test('owner governance never changes inventory, reservations, bindings or provider state', () => {
  const combined = service + client + panel;
  assert.doesNotMatch(
    combined,
    /inventoryCatalog|currentQuantity|retryNinetyNineFoodBlockedOrderReservation|sendNinetyNineFoodOrderStatus|bindNinetyNineFood|MercadoLivre.*write|provider_write/i
  );
  assert.ok(panel.includes('não altera saldo físico, bindings, reservas, pedidos ou estado em provedores externos'));
});

test('confirmed ownership decisions refresh authority, queue and physical inventory views', () => {
  assert.ok(bridge.includes('StoreOwnerGovernancePanel'));
  assert.ok(bridge.includes('onApplied={() => setAuthorityRefreshVersion(version => version + 1)}'));
  assert.ok(bridge.includes('key={`channel-center-${storeViewRefreshVersion}`}'));
  assert.ok(bridge.includes('key={`channel-operations-${storeViewRefreshVersion}`}'));
  assert.ok(bridge.includes('key={`physical-inventory-${storeViewRefreshVersion}`}'));
});
