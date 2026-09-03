import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { buildStoreChannelOperationalItems } from '../src/utils/storeChannelOperations.js';

const resolutionService = readFileSync(
  'server/integrations/ninetyNineFoodOrderBlockResolutionService.ts',
  'utf8'
);
const authorityService = readFileSync(
  'server/inventory/canonicalInventoryAuthorityService.ts',
  'utf8'
);
const queueComponent = readFileSync(
  'src/components/store/StoreChannelOperationsQueue.tsx',
  'utf8'
);

test('99Food authority blocks remain visible as critical queue items without guessed remediation', () => {
  const items = buildStoreChannelOperationalItems({
    mercadoLivreReview: [],
    mercadoLivreConflicts: [],
    ninetyNineFoodBlocked: [{
      orderId: 'order-authority',
      externalOrderId: 'ext-authority',
      displayId: 'AUTH',
      customerName: 'Cliente',
      blockedState: 'blocked_authority_unresolved',
      blockedDetail: 'owner unresolved',
      canonicalProductIds: ['product-burger'],
      status: 'accepted',
    }],
  });

  assert.equal(items.length, 1);
  assert.equal(items[0].kind, '99food_authority_unresolved');
  assert.equal(items[0].severity, 'critical');
  assert.equal(items[0].remediationTarget, undefined);
  assert.equal(items[0].remediationExternalProductIds, undefined);
  assert.equal(items[0].remediationInventoryItemId, undefined);
  assert.deepEqual(items[0].evidence, ['Produtos Kyrub envolvidos: product-burger']);
  assert.match(items[0].detail, /Nenhum owner ou inventário alternativo foi escolhido por inferência/);
});

test('blocked-order service keeps authority unresolved in the official operator queue and retry boundary', () => {
  assert.match(
    resolutionService,
    /BLOCKED_STATES[\s\S]*blocked_authority_unresolved/
  );
  assert.match(
    resolutionService,
    /blockedState:[\s\S]*blocked_authority_unresolved/
  );
  assert.match(
    resolutionService,
    /if \(!BLOCKED_STATES\.has\(inventoryReservationState\(order\)\)\)/
  );
});

test('99Food preflight reports unresolved canonical authority instead of selecting a fallback', () => {
  const preflightSection = resolutionService.match(
    /export const preflightNinetyNineFoodBlockedOrderReservation[\s\S]*?\n};\n\nexport const retryNinetyNineFoodBlockedOrderReservation/
  )?.[0] ?? '';

  assert.match(preflightSection, /INVENTORY_AUTHORITY_OWNER_UNRESOLVED/);
  assert.match(preflightSection, /INVENTORY_AUTHORITY_DOCUMENT_NOT_FOUND/);
  assert.match(preflightSection, /state: 'authority_unresolved'/);
  assert.doesNotMatch(preflightSection, /legacyTenantInventoryAuthority|inventoryDocumentPathForOwner|transaction\.create|transaction\.set|batch\.commit/);
});

test('canonical inventory authority still requires exactly one active owner', () => {
  assert.match(authorityService, /where\('role', '==', 'owner'\)/);
  assert.match(authorityService, /data\.status === 'active'/);
  assert.match(authorityService, /activeOwners\.length !== 1/);
  assert.match(authorityService, /INVENTORY_AUTHORITY_OWNER_UNRESOLVED/);
});

test('operations queue explains authority block without binding or inventory mutation shortcut', () => {
  assert.match(queueComponent, /99food_authority_unresolved': 'Autoridade de estoque não resolvida/);
  assert.match(queueComponent, /preflight\.state === 'authority_unresolved'/);
  assert.match(queueComponent, /O Kyrub não escolherá um owner ou inventário alternativo por aproximação/);
  assert.match(queueComponent, /Corrija a configuração da loja e use “Verificar ATP” novamente/);

  const authorityGuidance = queueComponent.match(
    /item\.kind === '99food_authority_unresolved'[\s\S]*?<\/p>/
  )?.[0] ?? '';
  assert.doesNotMatch(
    authorityGuidance,
    /requestNinetyNineFoodBindingRemediation|requestPhysicalInventoryFocus|retryNinetyNineFoodBlockedOrderReservation|fetch\(/
  );
});
