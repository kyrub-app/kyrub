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

test('zero owners stay in the existing repair lane while any foreign active owner exposes canonical-owner reconciliation', () => {
  const zeroIndex = service.indexOf('if (activeOwnerIds.length === 0)');
  const absentIndex = service.indexOf('if (!activeOwnerIds.includes(canonicalOwnerId))');
  const singleIndex = service.indexOf('if (activeOwnerIds.length === 1)');
  assert.ok(zeroIndex >= 0);
  assert.ok(absentIndex > zeroIndex);
  assert.ok(singleIndex > absentIndex);
  assert.ok(service.includes("state: 'canonical_owner_not_active'"));
  assert.ok(service.includes("state: 'no_conflict'"));
});

test('canonical owner activation preview is fingerprinted from the exact current conflict', () => {
  assert.ok(service.includes('canonicalOwnerActivationIdFor'));
  assert.ok(service.includes('context.state === \'canonical_owner_not_active\''));
  assert.ok(service.includes('canonicalOwnerActivationId'));
  assert.ok(service.includes('activeOwnerIds: [...input.activeOwnerIds].sort()'));
  assert.ok(client.includes('canonicalOwnerActivationId: string'));
});

test('reconciliation only activates the explicit canonical root owner after exact scope alignment', () => {
  assert.ok(service.includes('canonicalOwnerId !== tenantId'));
  assert.ok(service.includes('clean(privateStore?.ownerId) !== tenantId'));
  assert.ok(service.includes('clean(tenant?.ownerId) !== tenantId'));
  assert.ok(service.includes('context.state !== \'canonical_owner_not_active\''));
  assert.ok(service.includes('members/${context.canonicalOwnerId}'));
  assert.ok(service.includes('userId: context.canonicalOwnerId'));
  assert.ok(service.includes("role: 'owner'"));
  assert.ok(service.includes("status: 'active'"));
});

test('canonical owner activation never deactivates existing owners in the same decision', () => {
  const reconciliation = service.slice(service.indexOf('export const applyCanonicalOwnerReconciliation'));
  assert.doesNotMatch(reconciliation, /status:\s*['"]inactive['"]|ownerAuthorityRevokedAt|deactivate_additional_owner_membership/);
  assert.ok(panel.includes('Nenhum dos owners atualmente ativos será desativado nesta etapa.'));
  assert.ok(panel.includes('cada owner adicional seja revisado separadamente'));
});

test('canonical owner membership identity conflicts block reconciliation instead of overwriting another user', () => {
  assert.ok(service.includes('existingUserId && existingUserId !== context.canonicalOwnerId'));
  assert.ok(service.includes('STORE_CANONICAL_OWNER_RECONCILIATION_MEMBER_CONFLICT'));
  assert.ok(router.includes('membership do owner canônico aponta para outra identidade'));
});

test('canonical owner reconciliation is a separate confirmed POST with stale-state rejection', () => {
  assert.ok(router.includes("router.post('/:storeId/owner-governance/reconcile-canonical-owner'"));
  assert.ok(router.includes('applyCanonicalOwnerReconciliation'));
  assert.ok(router.includes('activationId: clean(request.body?.activationId)'));
  assert.ok(router.includes('confirmed: request.body?.confirmed === true'));
  assert.ok(client.includes('/owner-governance/reconcile-canonical-owner'));
  assert.ok(client.includes('activationId: preview.canonicalOwnerActivationId'));
  assert.ok(client.includes('confirmed: true'));
  assert.ok(service.includes('STORE_CANONICAL_OWNER_RECONCILIATION_STALE'));
});

test('UI requires a second explicit confirmation before canonical owner activation', () => {
  assert.ok(panel.includes('armedCanonicalOwnerActivation'));
  assert.ok(panel.includes('Revisar ativação do owner canônico'));
  assert.ok(panel.includes('Confirmar ativação do owner canônico'));
  assert.ok(panel.includes('confirmCanonicalOwnerReconciliation(user, storeId, preview)'));
  assert.ok(panel.includes('owner definido pela loja canônica'));
});

test('reconciliation writes no inventory, reservation, binding, order or provider state', () => {
  const reconciliation = service.slice(service.indexOf('export const applyCanonicalOwnerReconciliation'));
  const combined = reconciliation + client + panel;
  assert.doesNotMatch(
    combined,
    /inventoryCatalog|currentQuantity|retryNinetyNineFoodBlockedOrderReservation|sendNinetyNineFoodOrderStatus|bindNinetyNineFood|MercadoLivre.*write|provider_write/i
  );
  assert.ok(panel.includes('não altera saldo físico, bindings, reservas, pedidos ou estado em provedores externos'));
});
