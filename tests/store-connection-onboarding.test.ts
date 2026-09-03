import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import {
  buildStoreCommerceChannelDeclarationFromAnswer,
} from '../shared/storeConnectionOnboarding.js';
import { parseStoreConnectionSyncAuthority } from '../server/integrations/storeConnectionRegistry.js';
import {
  resolveKyrubiaStoreConnectionDeclarationIntent,
} from '../src/ai/deterministicStoreConnectionOnboarding.js';
import { buildStoreChannelOperationalItems } from '../src/utils/storeChannelOperations.js';

test('merchant answer deterministically declares existing commerce channels without connecting them', () => {
  const declaration = buildStoreCommerceChannelDeclarationFromAnswer({
    storeId: 'store-a',
    declaredByUserId: 'store-a',
    answer: 'Já vendo no Mercado Livre, Shopee, iFood e Instagram.',
    declaredAt: '2026-08-30T23:30:00.000Z',
  });
  assert.deepEqual(declaration.channels, ['mercado_livre', 'shopee', 'ifood', 'instagram']);
  assert.equal(declaration.authority, 'store_owner');
  assert.equal(declaration.source, 'merchant_onboarding');
});

test('merchant channel declaration is owner scoped', () => {
  assert.throws(() => buildStoreCommerceChannelDeclarationFromAnswer({
    storeId: 'store-a',
    declaredByUserId: 'store-b',
    answer: 'Mercado Livre',
    declaredAt: '2026-08-30T23:30:00.000Z',
  }), /STORE_CHANNEL_DECLARATION_SCOPE_INVALID/);
});

test('store connection onboarding API rejects cross-tenant identity before loading registry', () => {
  const source = readFileSync('server/integrations/storeConnectionOnboardingRouter.ts', 'utf8');
  assert.match(source, /identity\.uid !== storeId/);
  assert.match(source, /STORE_CONNECTION_FORBIDDEN/);
});

test('public store connection registry projection never exposes vault references or raw credentials', () => {
  const source = readFileSync('server/integrations/storeConnectionRegistry.ts', 'utf8');
  const projection = source.match(/const publicProjection[\s\S]*?\n};/)?.[0] ?? '';
  assert.match(projection, /credentialAuthority: 'vault'/);
  assert.doesNotMatch(projection, /credentialReference|accessToken|refreshToken|clientSecret/);
});

test('sync authority accepts only explicit shared authority modes', () => {
  assert.equal(parseStoreConnectionSyncAuthority('external_to_kyrub'), 'external_to_kyrub');
  assert.equal(parseStoreConnectionSyncAuthority('manual_review'), 'manual_review');
  assert.throws(() => parseStoreConnectionSyncAuthority('automatic'), /STORE_CONNECTION_SYNC_AUTHORITY_INVALID/);
});

test('Kyrubia recognizes existing-channel declarations deterministically and ignores future intent', () => {
  assert.deepEqual(resolveKyrubiaStoreConnectionDeclarationIntent('Mercado Livre e 99Food'), {
    answer: 'Mercado Livre e 99Food',
    channels: ['mercado_livre', '99food'],
    kind: 'channels_declared',
  });
  assert.equal(resolveKyrubiaStoreConnectionDeclarationIntent('Quero vender na Shopee'), null);
  assert.equal(resolveKyrubiaStoreConnectionDeclarationIntent('Como conectar Mercado Livre?'), null);
});

test('Kyrubia can explicitly register no external sales channels', () => {
  assert.deepEqual(resolveKyrubiaStoreConnectionDeclarationIntent('Não vendo em nenhum outro lugar hoje.'), {
    answer: 'Não vendo em nenhum outro lugar hoje.',
    channels: [],
    kind: 'no_external_channels',
  });
});

test('Kyrubia prepares channel declaration for human confirmation instead of persisting from chat router', () => {
  const router = readFileSync('src/ai/storePromotionWorkspaceRouter.ts', 'utf8');
  assert.match(router, /resolveKyrubiaStoreConnectionDeclarationIntent/);
  assert.match(router, /emitKyrubStoreConnectionOnboardingProposal/);
  assert.doesNotMatch(router, /\/api\/store-connections|saveStoreCommerceChannelDeclaration/);
});

test('channel confirmation persists only the reviewed declaration', () => {
  const bridge = readFileSync('src/components/KyrubAiStoreConnectionOnboardingBridge.tsx', 'utf8');
  const client = readFileSync('src/utils/storeConnectionOnboarding.ts', 'utf8');
  assert.match(bridge, /Confirmar canais/);
  assert.match(bridge, /Não conecta nenhuma conta/);
  assert.match(client, /\/api\/store-connections\/\$\{encoded\(storeId\)\}\/channels/);
  assert.match(client, /method: 'PUT'/);
  assert.doesNotMatch(client, /authorize|catalog-import|sync-authority|accessToken|refreshToken|clientSecret/);
});

test('Central de Canais remains a read-only projection over declaration and connection registry', () => {
  const source = readFileSync('src/components/store/StoreChannelCenter.tsx', 'utf8');
  assert.match(source, /Central de Canais/);
  assert.match(source, /loadStoreConnectionOnboarding/);
  assert.match(source, /Kyrub Marketplace/);
  assert.doesNotMatch(source, /beginMercadoLivreConnection|connectNinetyNineFoodAdaptive|updateStoreConnectionSyncAuthority/);
});

test('multichannel normalizer prioritizes conflict and routes 99Food binding remediation explicitly', () => {
  const items = buildStoreChannelOperationalItems({
    mercadoLivreReview: [{ proposal: { id: 'proposal-1' }, snapshot: { item: { externalId: 'MLB1', title: 'Produto A' } } }] as never[],
    mercadoLivreConflicts: [{ proposalId: 'proposal-1', canonicalProductId: 'product-a', baselineStatus: 'conflict', resolvableFields: ['name'] }] as never[],
    ninetyNineFoodBlocked: [{
      orderId: 'order-99', externalOrderId: 'ext-99', displayId: '99', customerName: 'Cliente',
      blockedState: 'blocked_product_binding_unresolved', blockedDetail: 'binding ausente', status: 'accepted',
      unresolvedExternalProductIds: ['ext-product-b', 'ext-product-a'],
    }],
  });
  assert.equal(items.length, 2);
  assert.equal(items[0].kind, '99food_binding_unresolved');
  assert.equal(items[0].remediationTarget, '99food_binding');
  assert.deepEqual(items[0].evidence, ['Produtos externos sem binding: ext-product-b, ext-product-a']);
  assert.equal(items.some(item => item.kind === 'mercado_livre_sync_review'), false);
});

test('99Food ATP item exposes exact canonical product and shortage evidence', () => {
  const items = buildStoreChannelOperationalItems({
    mercadoLivreReview: [],
    mercadoLivreConflicts: [],
    ninetyNineFoodBlocked: [{
      orderId: 'order-atp', externalOrderId: 'ext-atp', displayId: 'ATP', customerName: 'Cliente',
      blockedState: 'blocked_insufficient_atp', blockedDetail: 'atp insuficiente', status: 'accepted',
      canonicalProductIds: ['product-burger'],
      inventoryItemId: 'ingredient-meat',
      requiredQuantity: 4,
      availableQuantity: 2.5,
    }],
  });
  assert.equal(items[0].remediationTarget, 'kyrub_inventory');
  assert.deepEqual(items[0].evidence, [
    'Produtos Kyrub envolvidos: product-burger',
    'Item de estoque com ATP insuficiente: ingredient-meat',
    'Necessário: 4 · disponível: 2.5',
  ]);
});

test('legacy blocked orders without structured evidence remain renderable', () => {
  const items = buildStoreChannelOperationalItems({
    mercadoLivreReview: [], mercadoLivreConflicts: [],
    ninetyNineFoodBlocked: [{
      orderId: 'legacy', externalOrderId: 'legacy-ext', displayId: '', customerName: '',
      blockedState: 'blocked_product_binding_unresolved', blockedDetail: 'legacy detail', status: 'accepted',
    }],
  });
  assert.deepEqual(items[0].evidence, []);
  assert.equal(items[0].remediationTarget, '99food_binding');
});

test('canonical ATP shortage is a typed error carrying authoritative shortage fields', () => {
  const source = readFileSync('server/inventory/canonicalInventoryReservationService.ts', 'utf8');
  assert.match(source, /class InventoryAvailableToPromiseExceededError extends Error/);
  assert.match(source, /readonly inventoryItemId: string/);
  assert.match(source, /readonly requiredQuantity: number/);
  assert.match(source, /readonly availableQuantity: number/);
  assert.match(source, /throw new InventoryAvailableToPromiseExceededError/);
});

test('99Food reservation lifecycle persists structured block evidence and clears stale evidence on later states', () => {
  const source = readFileSync('server/inventory/ninetyNineFoodReservationLifecycle.ts', 'utf8');
  assert.match(source, /unresolvedExternalProductIds: evidence\.unresolvedExternalProductIds \?\? \[\]/);
  assert.match(source, /canonicalProductIds: evidence\.canonicalProductIds \?\? \[\]/);
  assert.match(source, /inventoryItemId: evidence\.inventoryItemId \?\? ''/);
  assert.match(source, /error instanceof InventoryAvailableToPromiseExceededError/);
  assert.match(source, /requiredQuantity: error\.requiredQuantity/);
  assert.match(source, /availableQuantity: error\.availableQuantity/);
  assert.doesNotMatch(source, /split\(':')/);
});

test('blocked-order API projects structured remediation evidence without exposing credentials', () => {
  const source = readFileSync('server/integrations/ninetyNineFoodOrderBlockResolutionService.ts', 'utf8');
  assert.match(source, /unresolvedExternalProductIds: stringList\(reservation\.unresolvedExternalProductIds\)/);
  assert.match(source, /canonicalProductIds: stringList\(reservation\.canonicalProductIds\)/);
  assert.match(source, /inventoryItemId: clean\(reservation\.inventoryItemId/);
  assert.match(source, /requiredQuantity: finiteNumber\(reservation\.requiredQuantity\)/);
  assert.match(source, /availableQuantity: finiteNumber\(reservation\.availableQuantity\)/);
  assert.doesNotMatch(source, /accessToken|refreshToken|clientSecret|credentialReference/);
});

test('multichannel queue exposes only internal reservation retry write and deterministic navigation', () => {
  const source = readFileSync('src/utils/storeChannelOperations.ts', 'utf8');
  const component = readFileSync('src/components/store/StoreChannelOperationsQueue.tsx', 'utf8');
  const bridge = readFileSync('src/components/store/NinetyNineFoodE2ETestBridge.tsx', 'utf8');
  assert.match(source, /retry-reservation/);
  assert.match(source, /Promise\.allSettled/);
  assert.doesNotMatch(source, /blocked-orders\/.*\/reject|orders\/.*\/status|decideMercadoLivreSyncProposal/);
  assert.match(component, /Evidência do bloqueio/);
  assert.match(component, /Corrigir binding/);
  assert.match(component, /Abrir estoque/);
  assert.match(bridge, /id="kyrub-99food-product-binding-workspace"/);
});

test('99Food reservation retry stays inside canonical reconciliation and never writes provider status', () => {
  const service = readFileSync('server/integrations/ninetyNineFoodOrderBlockResolutionService.ts', 'utf8');
  const retrySection = service.match(/export const retryNinetyNineFoodBlockedOrderReservation[\s\S]*?\n};\n\nexport const rejectNinetyNineFoodBlockedOrder/)?.[0] ?? '';
  assert.match(retrySection, /reconcileNinetyNineFoodOrderReservation/);
  assert.match(retrySection, /BLOCKED_STATES\.has/);
  assert.doesNotMatch(retrySection, /sendNinetyNineFoodOrderStatus|provider_write_succeeded|rejected/);
});
